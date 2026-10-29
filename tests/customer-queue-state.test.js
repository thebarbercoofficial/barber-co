const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

async function main() {
  const nodes = Object.fromEntries(['#app', '[data-live-summary]', '[data-live-rows]', '[data-ticket-panel]', '[data-walkin]'].map((key) => [key, { innerHTML: '', addEventListener() {} }]));
  const fixture = { queue: [], ticket: { queueNumber: 11, status: 'done' }, position: 0, waitingAhead: 0 };
  let fail = false;
  const context = vm.createContext({
    URLSearchParams, console,
    location: { search: '?ticket=saved', origin: 'https://test.invalid', pathname: '/queue.html' },
    localStorage: { getItem: () => 'saved' },
    navigator: {}, window: { setTimeout() {} },
    document: { querySelector: (key) => nodes[key], addEventListener() {} },
    BarberCo: {
      state: { services: [], queue: [{ customer: 'STALE LOCAL TICKET', status: 'serving' }], appointments: [{ customer: 'STALE APPOINTMENT' }] },
      barbers: [], nav: () => '', initHeader() {}, byId: () => ({ name: 'Haircut' }), loadCatalog: async () => {}, serviceOptions: () => '', toast() {},
      api: async (path) => { if (fail) throw new Error('Offline'); return path.startsWith('/queue/ticket/') ? fixture : { queue: fixture.queue }; }
    }
  });
  vm.runInContext(fs.readFileSync(require.resolve('../js/pages/queue.js'), 'utf8'), context);
  await new Promise(setImmediate);
  assert.match(nodes['[data-ticket-panel]'].innerHTML, /Completed/);
  assert.doesNotMatch(nodes['[data-ticket-panel]'].innerHTML, /Now serving/);
  assert.doesNotMatch(nodes['[data-live-summary]'].innerHTML, /STALE|Queue #/);
  fixture.queue = [{ id: 'a', queueNumber: 12, status: 'waiting', customer: '<b>Ria</b>', cutName: 'Basic' }];
  await vm.runInContext('refreshPublicQueue()', context);
  assert.match(nodes['[data-live-summary]'].innerHTML, /Next in line/);
  assert.equal((nodes['[data-live-summary]'].innerHTML.match(/Queue #12/g) || []).length, 1);
  assert.match(nodes['[data-live-summary]'].innerHTML, /&lt;b&gt;Ria&lt;\/b&gt;/);
  fixture.ticket.status = 'waiting'; fixture.position = 2; fixture.waitingAhead = 1;
  await vm.runInContext("updateTicket('saved')", context);
  assert.match(nodes['[data-ticket-panel]'].innerHTML, /#2 in line/);
  fixture.ticket.status = 'serving';
  await vm.runInContext("updateTicket('saved')", context);
  assert.match(nodes['[data-ticket-panel]'].innerHTML, /Now serving/);
  fixture.ticket.status = 'cancelled';
  await vm.runInContext("updateTicket('saved')", context);
  assert.match(nodes['[data-ticket-panel]'].innerHTML, /Cancelled/);
  assert.doesNotMatch(nodes['[data-ticket-panel]'].innerHTML, /Now serving/);
  fail = true;
  await vm.runInContext('refreshPublicQueue()', context);
  await vm.runInContext("updateTicket('saved')", context);
  assert.match(nodes['[data-live-summary]'].innerHTML, /Live queue unavailable/);
  assert.match(nodes['[data-ticket-panel]'].innerHTML, /Ticket status unavailable/);
  assert.doesNotMatch(nodes['[data-live-summary]'].innerHTML, /STALE|Queue #12/);
  console.log('Customer queue: completed/cancelled/serving/waiting labels, no stale fallback, no duplicate next customer, escaped names and outage states passed.');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
