# eAuto Insurance Quote Checker

Automated Playwright script that checks insurance quotations for multiple vehicles on the eAuto staging back office.

## What It Does

1. **Reads** a list of vehicle numbers from an Excel file (`input-vehicles.xlsx`)
2. **Logs in** to eAuto staging back office
3. **For each vehicle**, submits the Insurance Quote Enquiry form:
   - Fills in Vehicle Number, IC Number, Postcode
   - Handles the "no approved eSTM transaction" popup automatically
   - Clicks GET QUOTE to fetch insurer data
4. **Skips** vehicles that return "Unable to retrieve your vehicle information"
5. **Extracts** for each valid vehicle:
   - Vehicle Make, Model, Manufacturing Year
   - Each insurer name and cover type
   - Whether insurance purchase is allowed (Yes/No)
   - Refer Risk Code (if not allowed)
   - Total Price
6. **Outputs** results to a formatted Excel file (`output-results.xlsx`) with:
   - **Summary** sheet: All vehicles with quotations (one row per insurer per vehicle)
   - **Skipped Vehicles** sheet: Vehicles that had no data or errors

## Setup

```bash
# Install dependencies
npm install

# Install Playwright browsers
npm run install-browsers
```

## Prepare Input File

Create `input-vehicles.xlsx` in the project root with this structure:

| Vehicle Number | IC Number      | Postcode | Vehicle Category |
|---------------|----------------|----------|-----------------|
| JKC9998       | 020406081081   | 31150    | Individual      |
| VJ3144        | 020406081081   | 31150    | Individual      |
| AAAAAAA8      | 020406081081   | 31150    | Individual      |

- **Column A** (required): Vehicle Number
- **Column B** (optional): IC Number — defaults to `020406081081` if empty
- **Column C** (optional): Postcode — defaults to `31150` if empty
- **Column D** (optional): Vehicle Category — defaults to `Individual` if empty

> **Tip**: If you run the script without an input file, it will generate a sample one for you.

## Configuration

Edit the `CONFIG` object at the top of `insurance-checker.spec.ts` to change:

```typescript
const CONFIG = {
  baseUrl: 'https://staging.eauto.my/sit3',    // Change environment here
  username: 'Jasons',
  password: 'Pw1234',
  icNumber: '020406081081',      // Default IC if not in Excel
  postcode: '31150',              // Default postcode if not in Excel
  vehicleCategory: 'Individual',  // Default category if not in Excel
  inputFile: './input-vehicles.xlsx',
  outputFile: './output-results.xlsx',
};
```

### Switching Environments
Just change the `baseUrl`:
- SIT2: `https://staging.eauto.my/sit2`
- SIT3: `https://staging.eauto.my/sit3`
- Preprod1: `https://staging.eauto.my/preprod1`
- UAT2: `https://staging.eauto.my/uat2`
- UAT3: `https://staging.eauto.my/uat3`

## Run

```bash
# Run with browser visible (recommended for first run)
npm run test:headed

# Run headless (faster, no browser window)
npm test

# Run with Playwright debugger (step through)
npm run test:debug
```

## Output

After running, check `output-results.xlsx`:

### Summary Sheet
| Vehicle Number | Make  | Model             | Mfg Year | Insurer      | Allow Purchase | Refer Risk Code | Total Price  |
|---------------|-------|-------------------|----------|--------------|----------------|-----------------|--------------|
| JKC9998       | HONDA | Honda Accord 2.4  | 2007     | Chubb        | Yes            | -               | RM 1,580.80  |
| JKC9998       | HONDA | Honda Accord 2.4  | 2007     | Zurich       | Yes            | -               | RM 1,075.23  |
| JKC9998       | HONDA | Honda Accord 2.4  | 2007     | Tokio Marine | No             | Account blocked | -            |

### Skipped Vehicles Sheet
| Vehicle Number | Status           | Reason                                      |
|---------------|------------------|---------------------------------------------|
| AAAAAAA8      | NO_VEHICLE_INFO  | Unable to retrieve your vehicle information |

## Notes

- The eAuto website can be **slow** (~15-30 seconds per vehicle). Be patient with large lists.
- **Session timeouts**: The script navigates fresh to the enquiry page for each vehicle to avoid stale sessions.
- **Alert handling**: The "no approved eSTM transaction" popup is handled automatically.
- For large batches (50+ vehicles), consider running in headless mode to save resources.
