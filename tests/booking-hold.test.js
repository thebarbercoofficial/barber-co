const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const source = `${fs.readFileSync("api/index.js", "utf8")}\nmodule.exports.__test = { appointmentSlotIds, lockAppointmentSlots };`;
const context = { require, module: { exports: {} }, exports: {}, process, console, setTimeout };
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

  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
  const results = await Promise.allSettled([
    lockAppointmentSlots(database, "hold-a", "2026-10-01", "barber-a", "13:00", 45, expiresAt),
    lockAppointmentSlots(database, "hold-b", "2026-10-01", "barber-a", "13:00", 45, expiresAt)
  ]);

  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected" && result.reason.status === 409).length, 1);
  console.log("booking hold concurrency test passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
