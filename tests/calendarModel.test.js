import assert from "node:assert/strict";
import { parseYmdAny, advanceYmd, monthKeyFromYmd, ymdFromDate } from "../src/modules/calendarModel.js";

{
    const d = parseYmdAny("2230-01-01");
    assert.ok(d instanceof Date);
    assert.equal(ymdFromDate(d), "2230-01-01");
}

{
    assert.equal(parseYmdAny("2230-13-01"), null);
    assert.equal(parseYmdAny("2230-00-01"), null);
    assert.equal(parseYmdAny("2230-02-30"), null);
    assert.equal(parseYmdAny(""), null);
}

{
    assert.equal(advanceYmd("2230-01-01", 1), "2230-01-02");
    assert.equal(advanceYmd("2230-01-01", -1), "2229-12-31");
    assert.equal(advanceYmd("2230-01-01", 7), "2230-01-08");
}

{
    assert.equal(monthKeyFromYmd("2230-11-05"), "2230-11");
}

console.log("calendarModel tests: OK");

