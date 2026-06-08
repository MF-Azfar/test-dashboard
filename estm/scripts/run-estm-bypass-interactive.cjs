const { createInterface } = require('node:readline/promises');
const { stdin, stdout, env } = require('node:process');
const { spawn } = require('node:child_process');

const askNonEmpty = async (rl, prompt) => {
  while (true) {
    const answer = (await rl.question(prompt)).trim();
    if (answer.length > 0) return answer;
    console.log('This field is required. Please provide a value.');
  }
};

const askYesNo = async (rl, prompt) => {
  while (true) {
    const answer = (await rl.question(prompt)).trim().toLowerCase();
    if (answer === 'y' || answer === 'yes') return true;
    if (answer === 'n' || answer === 'no') return false;
    console.log('Please answer Y/Yes or N/No.');
  }
};

const askIdentityType = async (rl) => {
  while (true) {
    const answer = (await rl.question('Select ID type (1 = MyKad, 2 = MyPR): ')).trim();
    if (answer === '1' || answer === '2') return answer;
    console.log('Please enter 1 for MyKad or 2 for MyPR.');
  }
};

const randomChars = (length) => {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
};

const randomDigits = (length) => {
  let result = '';
  for (let i = 0; i < length; i++) {
    result += Math.floor(Math.random() * 10).toString();
  }
  return result;
};

const randomEmailAddress = () => `${randomChars(10)}@test.com`;

const randomMobileNo = () => {
  const totalLength = 9 + Math.floor(Math.random() * 3);
  return `01${randomDigits(totalLength - 2)}`;
};

const run = async () => {
  if (!stdin.isTTY) {
    throw new Error('Interactive terminal is required for this launcher.');
  }

  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const envSegment = await askNonEmpty(rl, 'Enter staging (e.g. sit2): ');

    const usernameInput = (await rl.question('Enter Username (press Enter to use default: azfar1): ')).trim();
    const username = usernameInput || 'azfar1';
    if (!usernameInput) console.log('Using default Username: azfar1');

    const passwordInput = (await rl.question('Enter Password (press Enter to use default: 123456): ')).trim();
    const password = passwordInput || '123456';
    if (!passwordInput) console.log('Using default Password: 123456');

    const idType = await askIdentityType(rl);
    if (idType === '1') {
      console.log('Selected MyKad');
    } else {
      console.log('Selected MyPR');
    }

    const vehicleRegNo = await askNonEmpty(rl, 'Enter vehicle registration number for #vehicleRegNo: ');
    const shouldRandomizeEmailAddress = await askYesNo(rl, 'Randomize Email Address? (Y/N): ');
    const emailAddress = shouldRandomizeEmailAddress
      ? randomEmailAddress()
      : await askNonEmpty(rl, 'Enter value for Email Address: ');
    if (shouldRandomizeEmailAddress) {
      console.log(`Generated Email Address: ${emailAddress}`);
    }

    const shouldRandomizeMobileNo = await askYesNo(rl, 'Randomize Mobile No? (Y/N): ');
    const mobileNo = shouldRandomizeMobileNo
      ? randomMobileNo()
      : await askNonEmpty(rl, 'Enter value for Mobile No: ');
    if (shouldRandomizeMobileNo) {
      console.log(`Generated Mobile No: ${mobileNo}`);
    }

    const command = [
      'npx',
      'playwright',
      'test',
      'tests/estm-bypass-test.spec.ts',
      '--project=chromium',
      '--headed',
      '--workers=1',
    ].join(' ');

    const child = spawn(command, {
      shell: true,
      stdio: 'inherit',
      env: {
        ...env,
        ESTM_ENV_SEGMENT: envSegment,
        ESTM_USERNAME: username,
        ESTM_PASSWORD: password,
        ESTM_ID_TYPE: idType,
        ESTM_VEHICLE_REG_NO: vehicleRegNo,
        ESTM_EMAIL_ADDRESS: emailAddress,
        ESTM_MOBILE_NO: mobileNo,
      },
    });

    child.on('exit', (code) => {
      process.exit(code ?? 1);
    });

    child.on('error', (error) => {
      console.error(error);
      process.exit(1);
    });
  } finally {
    rl.close();
  }
};

run().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
