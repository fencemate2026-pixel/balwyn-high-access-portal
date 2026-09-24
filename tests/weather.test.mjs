import test from 'node:test';
import assert from 'node:assert/strict';
import { createWeatherService } from '../lib/weather.ts';
const primary = { current: { temperature_2m: 18, weather_code: 0, wind_speed_10m: 9, relative_humidity_2m: 50 }, daily: { time: ['2026-09-25'], weather_code: [0], temperature_2m_max: [22], temperature_2m_min: [10] } };
test('weather caches and shares requests, serves bounded stale data on outage, then expires it', async () => {
  let time = Date.parse('2026-09-24T22:00:00Z'), calls = 0, failed = false;
  const get = createWeatherService(async () => { calls++; if (failed) throw Error('offline'); return Response.json(primary); }, () => time);
  const results = await Promise.all([get(),get(),get()]);
  assert.equal(calls,1); assert.equal(results[0].current.temp,18); assert.equal((await get()).stale,false); assert.equal(calls,1);
  failed = true; time += 11*60_000;
  assert.equal((await get()).stale,true); assert.equal(calls,3);
  await get(); assert.equal(calls,3);
  time += 60*60_000; await assert.rejects(get(), /unavailable/);
});
test('MET fallback converts wind to km/h and groups forecast by Melbourne date', async () => {
  const time = Date.parse('2026-09-24T22:00:00Z'); let calls = 0;
  const point = (t,temp) => ({ time:t, data:{instant:{details:{air_temperature:temp,wind_speed:5,relative_humidity:65}},next_6_hours:{summary:{symbol_code:'rain'}}} });
  const get = createWeatherService(async (url, options) => {
    calls++; if (String(url).includes('open-meteo')) return Response.json({}, {status:503});
    assert.match(options.headers['User-Agent'], /rjlcommercialgroup/);
    return Response.json({properties:{timeseries:[point('2026-09-24T22:00:00Z',12),point('2026-09-25T04:00:00Z',20)]}});
  }, () => time);
  const result = await get(); assert.equal(calls,2); assert.equal(result.source,'MET Norway'); assert.equal(result.current.wind,18);
  assert.equal(result.days[0].date,'2026-09-25'); assert.equal(result.days[0].max,20); assert.equal(result.days[0].min,12);
});
test('malformed primary forecast falls back instead of returning empty success', async () => {
  let calls=0; const get=createWeatherService(async()=>{calls++; return Response.json({});});
  await assert.rejects(get(), /unavailable/); assert.equal(calls,2);
});
