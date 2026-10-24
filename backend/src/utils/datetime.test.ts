import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isValidTimezone, isWithinOperatingHours, msUntilOperatingWindow } from './datetime.js';

const SP = 'America/Sao_Paulo';
const HOURS = { startHour: 9, endHour: 0 };

/** Horário de Brasília → instante UTC (sem horário de verão). */
function spTime(isoLocal: string): Date {
  const [datePart, timePart] = isoLocal.split('T');
  const [year, month, day] = datePart.split('-').map(Number);
  const [hour, minute, second = 0] = timePart.split(':').map(Number);
  return new Date(Date.UTC(year, month - 1, day, hour + 3, minute, second));
}

describe('datetime', () => {
  it('accepts valid IANA timezones', () => {
    assert.equal(isValidTimezone('America/Sao_Paulo'), true);
    assert.equal(isValidTimezone('UTC'), true);
  });

  it('rejects invalid timezones', () => {
    assert.equal(isValidTimezone('Invalid/Zone'), false);
  });

  it('allows collection between 09:00 and 23:59 in São Paulo', () => {
    assert.equal(isWithinOperatingHours(SP, HOURS, spTime('2026-07-12T09:00:00')), true);
    assert.equal(isWithinOperatingHours(SP, HOURS, spTime('2026-07-12T12:30:00')), true);
    assert.equal(isWithinOperatingHours(SP, HOURS, spTime('2026-07-12T23:59:00')), true);
  });

  it('blocks collection between 00:00 and 08:59 in São Paulo', () => {
    assert.equal(isWithinOperatingHours(SP, HOURS, spTime('2026-07-12T00:00:00')), false);
    assert.equal(isWithinOperatingHours(SP, HOURS, spTime('2026-07-12T03:15:00')), false);
    assert.equal(isWithinOperatingHours(SP, HOURS, spTime('2026-07-12T08:59:00')), false);
  });

  it('computes delay until next operating window', () => {
    const delay = msUntilOperatingWindow(SP, HOURS, spTime('2026-07-12T03:00:00'));
    assert.equal(delay, 6 * 60 * 60 * 1000);
  });
});
