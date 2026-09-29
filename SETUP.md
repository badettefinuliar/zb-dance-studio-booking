# ZB Dance Studio Automatic Booking Setup

The public website is hosted on GitHub Pages. For automatic shared availability, use a Google Sheet + Google Apps Script backend.

## 1. Create the booking database
1. Create a new Google Sheet named **ZB Dance Studio Bookings**.
2. Open the Sheet.
3. Go to **Extensions → Apps Script**.
4. Delete the sample code and paste the contents of `Code.gs` from this repository.
5. Save.

## 2. Set timezone
In Apps Script, open **Project Settings** and set timezone to **Asia/Manila**.

## 3. Deploy the API
1. Click **Deploy → New deployment**.
2. Choose **Web app**.
3. Execute as: **Me**.
4. Who has access: **Anyone**.
5. Click **Deploy** and authorize.
6. Copy the Web App URL ending in `/exec`.

## 4. Connect the website
In `index.html`, replace:

```
const API_URL = "";
```

with your Web App URL:

```
const API_URL = "https://script.google.com/macros/s/...../exec";
```

Then commit the change.

## How booking works
- Customer checks live availability.
- If available, customer clicks **Hold This Slot**.
- The backend creates a **PENDING** booking for 30 minutes.
- Other customers will see that slot as unavailable during the hold.
- After you verify GCash payment, change **Status** in the Google Sheet from **PENDING** to **CONFIRMED**.
- To release a slot, set Status to **CANCELLED**.
- Expired PENDING holds stop blocking the schedule automatically.

## Status values
- `PENDING` — temporary 30-minute hold
- `CONFIRMED` — blocks the schedule permanently
- `CANCELLED` — does not block the schedule
