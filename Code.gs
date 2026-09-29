const SHEET_NAME = 'Bookings';
const HOLD_MINUTES = 30;

function doGet(e) {
  try {
    setupSheet_();
    const action = String((e.parameter.action || '')).toLowerCase();
    if (action === 'check') {
      return json_(checkAvailability_(
        e.parameter.date,
        e.parameter.start,
        e.parameter.end
      ));
    }
    if (action === 'health') {
      return json_({ ok: true, service: 'ZB Dance Studio Booking API' });
    }
    return json_({ ok: false, error: 'Unknown action' });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    setupSheet_();
    const body = JSON.parse((e.postData && e.postData.contents) || '{}');
    const action = String(body.action || '').toLowerCase();

    if (action === 'reserve') {
      const availability = checkAvailability_(body.date, body.start, body.end);
      if (!availability.available) {
        return json_({ ok: false, available: false, error: 'That schedule is no longer available.' });
      }

      const bookingId = makeBookingId_();
      const createdAt = new Date();
      const holdUntil = new Date(createdAt.getTime() + HOLD_MINUTES * 60 * 1000);

      const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
      sheet.appendRow([
        bookingId,
        body.date || '',
        body.start || '',
        body.end || '',
        body.name || '',
        body.contact || '',
        body.purpose || '',
        Number(body.total || 0),
        Number(body.reservation || 0),
        Number(body.balance || 0),
        'PENDING',
        createdAt,
        holdUntil,
        ''
      ]);

      return json_({
        ok: true,
        available: true,
        bookingId,
        status: 'PENDING',
        holdMinutes: HOLD_MINUTES,
        holdUntil: holdUntil.toISOString()
      });
    }

    return json_({ ok: false, error: 'Unknown action' });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message ? err.message : err) });
  } finally {
    lock.releaseLock();
  }
}

function setupSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(SHEET_NAME);

  if (sheet.getLastRow() === 0) {
    sheet.appendRow([
      'Booking ID','Date','Start','End','Name','Contact','Purpose',
      'Total Fee','Reservation Fee','Balance','Status','Created At','Hold Until','Notes'
    ]);
    sheet.setFrozenRows(1);
  }
}

function checkAvailability_(date, start, end) {
  if (!date || !start || !end) {
    return { ok: false, available: false, error: 'Missing date/start/end.' };
  }

  const requestedStart = toMinutes_(start);
  const requestedEnd = toMinutes_(end);
  if (requestedEnd <= requestedStart) {
    return { ok: false, available: false, error: 'Invalid time range.' };
  }

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { ok: true, available: true };

  const rows = sheet.getRange(2, 1, lastRow - 1, 14).getValues();
  const now = new Date();

  for (const row of rows) {
    const rowDate = formatDate_(row[1]);
    if (rowDate !== date) continue;

    const rowStart = String(row[2] || '');
    const rowEnd = String(row[3] || '');
    const status = String(row[10] || '').toUpperCase();
    const holdUntil = row[12] instanceof Date ? row[12] : new Date(row[12]);

    const blocksSlot =
      status === 'CONFIRMED' ||
      (status === 'PENDING' && holdUntil instanceof Date && !isNaN(holdUntil) && holdUntil > now);

    if (!blocksSlot) continue;

    const bookedStart = toMinutes_(rowStart);
    const bookedEnd = toMinutes_(rowEnd);

    if (requestedStart < bookedEnd && requestedEnd > bookedStart) {
      return { ok: true, available: false };
    }
  }

  return { ok: true, available: true };
}

function toMinutes_(time) {
  const parts = String(time).split(':').map(Number);
  return parts[0] * 60 + parts[1];
}

function formatDate_(value) {
  if (value instanceof Date) {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  return String(value || '');
}

function makeBookingId_() {
  return 'ZB-' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd-HHmmss') +
    '-' + Math.floor(100 + Math.random() * 900);
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
