const { normalizeMobile } = require('./payment-settings');

function phoneQuery(number, excludeId) {
  const separated = (digits) => digits.split('').join('[\\s()-]*');
  const pattern = new RegExp(`^\\s*(?:${separated(number)}|\\+?${separated(`63${number.slice(1)}`)})\\s*$`);
  return {
    $or: [{ phoneLogin: number }, { phone: { $regex: pattern } }],
    ...(excludeId ? { _id: { $ne: excludeId } } : {})
  };
}

async function phoneUsers(database, number, excludeId) {
  return database.collection('users').find(phoneQuery(number, excludeId)).limit(2).toArray();
}

async function availablePhone(database, value, excludeId) {
  const number = normalizeMobile(value);
  if (number && (await phoneUsers(database, number, excludeId)).length) {
    const error = new Error('This mobile number is already linked to another account. Use email to sign in.');
    error.status = 409;
    throw error;
  }
  return number;
}

module.exports = { phoneUsers, availablePhone };
