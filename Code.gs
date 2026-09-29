const BOOKINGS_SHEET = 'Bookings';
const SETTINGS_SHEET = 'Settings';

function doGet(e) {
  try {
    setupSheets_();
    const action = String((e.parameter.action || '')).toLowerCase();

    if (action === 'settings') {
      return json_({ ok: true, settings: getSettings_() });
    }

    if (action === 'check') {
      return json_(checkAvailability_(e.parameter.date, e.parameter.start, e.parameter.end));
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
    setupSheets_();
    const body = JSON.parse((e.postData && e.postData.contents) || '{}');
    const action = String(body.action || '').toLowerCase();

    if (action === 'reserve') {
      const availability = checkAvailability_(body.date, body.start, body.end);
      if (!availability.available) {
        return json_({ ok: false, available: false, error: 'That schedule is no longer available.' });
      }

      const settings = getSettings_();
      const bookingId = makeBookingId_();
      const createdAt = new Date();
      const holdUntil = new Date(createdAt.getTime() + Number(settings.holdMinutes) * 60 * 1000);

      const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(BOOKINGS_SHEET);
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
        holdMinutes: Number(settings.holdMinutes),
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

function setupSheets_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  let bookings = ss.getSheetByName(BOOKINGS_SHEET);
  if (!bookings) bookings = ss.insertSheet(BOOKINGS_SHEET);
  if (bookings.getLastRow() === 0) {
    bookings.appendRow([
      'Booking ID','Date','Start','End','Name','Contact','Purpose',
      'Total Fee','Reservation Fee','Balance','Status','Created At','Hold Until','Notes'
    ]);
    bookings.setFrozenRows(1);
  }

  let settings = ss.getSheetByName(SETTINGS_SHEET);
  if (!settings) settings = ss.insertSheet(SETTINGS_SHEET);
  if (settings.getLastRow() === 0) {
    settings.appendRow(['Setting','Value','Notes']);
    settings.appendRow(['businessName','ZB Dance Studio','Business or studio name']);
    settings.appendRow(['businessTagline','Practice • Classes • Training • Master Classes','Short line under business name']);
    settings.appendRow(['locationLabel','Malolos, Bulacan','Location shown on the page']);
    settings.appendRow(['gcashName','Ma Bernadette L Finuliar','GCash account name']);
    settings.appendRow(['gcashNumber','09062305755','GCash mobile number']);
    settings.appendRow(['creatorBrand','Badette AI Systems','Small footer credit']);
    settings.appendRow(['dayRate',350,'Rate per hour before evening rate starts']);
    settings.appendRow(['eveningRate',500,'Rate per hour from evening start time onward']);
    settings.appendRow(['reservationPercent',25,'Reservation fee percentage']);
    settings.appendRow(['openingTime','08:00','Earliest booking start time']);
    settings.appendRow(['eveningStart','17:00','Evening rate begins at this time']);
    settings.appendRow(['holdMinutes',30,'Minutes a pending booking holds the slot']);
    settings.setFrozenRows(1);
  }
}

function getSettings_() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SETTINGS_SHEET);
  const rows = sheet.getRange(2, 1, Math.max(sheet.getLastRow() - 1, 1), 2).getValues();

  const defaults = {
    businessName: 'ZB Dance Studio',
    businessTagline: 'Practice • Classes • Training • Master Classes',
    locationLabel: 'Malolos, Bulacan',
    gcashName: 'Ma Bernadette L Finuliar',
    gcashNumber: '09062305755',
    creatorBrand: 'Badette AI Systems',
    dayRate: 350,
    eveningRate: 500,
    reservationPercent: 25,
    openingTime: '08:00',
    eveningStart: '17:00',
    holdMinutes: 30
  };

  const out = Object.assign({}, defaults);
  rows.forEach(row => {
    const key = String(row[0] || '').trim();
    if (!key) return;
    let value = row[1];

    if (['dayRate','eveningRate','reservationPercent','holdMinutes'].includes(key)) {
      value = Number(value);
      if (!isFinite(value)) return;
    } else if (['openingTime','eveningStart'].includes(key)) {
      if (value instanceof Date) {
        value = Utilities.formatDate(value, Session.getScriptTimeZone(), 'HH:mm');
      } else {
        value = String(value || '').trim();
      }
      if (!/^\d{2}:\d{2}$/.test(value)) return;
    } else {
      value = String(value);
    }
    out[key] = value;
  });

  return out;
}

function checkAvailability_(date, start, end) {
  if (!date || !start || !end) {
    return { ok: false, available: false, error: 'Missing date/start/end.' };
  }

  const settings = getSettings_();
  const requestedStart = toMinutes_(start);
  const requestedEnd = toMinutes_(end);

  if (requestedEnd <= requestedStart) {
    return { ok: false, available: false, error: 'Invalid time range.' };
  }

  if (requestedStart < toMinutes_(settings.openingTime)) {
    return { ok: false, available: false, error: 'Selected time is before opening.' };
  }

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(BOOKINGS_SHEET);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { ok: true, available: true, settings };

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
      return { ok: true, available: false, settings };
    }
  }

  return { ok: true, available: true, settings };
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
