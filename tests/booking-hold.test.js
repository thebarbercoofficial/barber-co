const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const source = `${fs.readFileSync("api/index.js", "utf8")}\nmodule.exports.__test = { appointmentSlotIds, lockAppointmentSlots };`;
const apiRequire = require('node:module').createRequire(require('node:path').resolve('api/index.js'));
const context = { require: apiRequire, module: { exports: {} }, exports: {}, process, console, setTimeout };
vm.runInNewContext(source, context);

const { appointmentSlotIds, lockAppointmentSlots } = context.module.exports.__test;

async function run() {
  assert.deepEqual(
    [...appointmentSlotIds("2026-10-01", "barber-a", "13:00", 45)],
    ["2026-10-01:barber-a:780", "2026-10-01:barber-a:795", "2026-10-01:barber-a:810"]
  );

  const slots = new Map();
  const database = {
    collection() {
      return {
        async insertMany(documents) {
          for (const document of documents) {
            if (slots.has(document._id)) {
              const error = new Error("duplicate slot");
              error.code = 11000;
              throw error;
            }
            slots.set(document._id, document);
          }
        },
        async deleteMany(query) {
          for (const [key, value] of slots) {
            if (value.appointmentId === query.appointmentId) slots.delete(key);
          }
        }
      };
    }
  };

  const results = await Promise.allSettled([
    lockAppointmentSlots(database, "approval-a", "2026-10-01", "barber-a", "13:00", 45),
    lockAppointmentSlots(database, "approval-b", "2026-10-01", "barber-a", "13:00", 45)
  ]);

  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected" && result.reason.status === 409).length, 1);
  assert.equal(slots.size, 3, 'Conflicting approval must retain all winning locks and leave no partial locks');
  assert.equal(new Set([...slots.values()].map(slot => slot.appointmentId)).size, 1);
  assert.ok([...slots.values()].every(slot => !slot.expiresAt), 'Approved capacity locks must not expire like checkout holds');
  const winningSlots = [...slots.entries()];
  await assert.rejects(
    lockAppointmentSlots(database, 'partial-approval', '2026-10-01', 'barber-a', '12:45', 45),
    error => error.status === 409
  );
  assert.deepEqual([...slots.entries()], winningSlots, 'A conflict after a partial insert must roll back only the losing approval');
  console.log("booking approval capacity concurrency test passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
