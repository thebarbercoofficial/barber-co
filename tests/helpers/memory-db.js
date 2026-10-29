const { ObjectId } = require('mongodb');
const same = (a, b) => String(a) === String(b);
function matches(item, query = {}) {
  return Object.entries(query).every(([key, expected]) => {
    if (key === '$or') return expected.some((condition) => matches(item, condition));
    if (key === '$and') return expected.every((condition) => matches(item, condition));
    const value = item[key];
    if (expected && typeof expected === 'object' && !(expected instanceof ObjectId) && !(expected instanceof Date)) return Object.entries(expected).every(([operator, argument]) => {
      if (operator === '$ne') return !same(value, argument);
      if (operator === '$gt') return value > argument;
      if (operator === '$lt') return value < argument;
      if (operator === '$in') return argument.some((candidate) => same(value, candidate));
      if (operator === '$nin') return !argument.some((candidate) => same(value, candidate));
      if (operator === '$exists') return (value !== undefined) === argument;
      if (operator === '$regex') return argument.test(String(value || ''));
      throw new Error(`Unsupported isolated query: ${operator}`);
    });
    return same(value, expected);
  });
}
function apply(item, changes, inserted) {
  if (inserted) Object.assign(item, changes.$setOnInsert);
  Object.assign(item, changes.$set);
  Object.entries(changes.$inc || {}).forEach(([key, value]) => { item[key] = (item[key] || 0) + value; });
  Object.keys(changes.$unset || {}).forEach((key) => { delete item[key]; });
}
function memoryDb(records = {}) {
  function unique(name, item, ignored) {
    const key = records[name].some((other) => other !== ignored && same(other._id, item._id)) ? '_id' : name === 'users' && records[name].some((other) => other !== ignored && other.email === item.email) ? 'email' : name === 'users' && item.phoneLogin && records[name].some((other) => other !== ignored && other.phoneLogin === item.phoneLogin) ? 'phoneLogin' : '';
    if (key) throw Object.assign(new Error('Duplicate record'), { code: 11000, keyPattern: { [key]: 1 } });
  }
  return { records, collection(name) {
    records[name] ||= [];
    const write = (query, changes, options = {}) => {
      let item = records[name].find((row) => matches(row, query));
      const inserted = !item && options.upsert;
      if (inserted) item = Object.fromEntries(Object.entries(query).filter(([, value]) => typeof value !== 'object' || value instanceof ObjectId));
      if (!item) return { matchedCount: 0, modifiedCount: 0 };
      const next = { ...item };
      apply(next, changes, inserted);
      unique(name, next, inserted ? null : item);
      Object.keys(item).forEach((key) => delete item[key]);
      Object.assign(item, next);
      if (inserted) records[name].push(item);
      return { matchedCount: 1, modifiedCount: 1, upsertedCount: inserted ? 1 : 0, ...(inserted ? { upsertedId: item._id } : {}), item: { ...item } };
    };
    return {
      async findOne(query) { const row = records[name].find((item) => matches(item, query)); return row ? { ...row } : null; },
      find(query = {}, options = {}) {
        let rows = records[name].filter((item) => matches(item, query));
        return {
          sort(order) { const [key, direction] = Object.entries(order)[0]; rows = rows.sort((a, b) => (a[key] > b[key] ? 1 : a[key] < b[key] ? -1 : 0) * direction); return this; },
          limit(count) { rows = rows.slice(0, count); return this; },
          async toArray() { return rows.map((item) => Object.fromEntries(Object.entries(item).filter(([key]) => !options.projection || (Object.values(options.projection).some(Boolean) ? key === '_id' || options.projection[key] : options.projection[key] !== 0)))); }
        };
      },
      async countDocuments(query) { return records[name].filter((item) => matches(item, query)).length; },
      async insertOne(item) { unique(name, item); records[name].push({ ...item }); return { insertedId: item._id }; },
      async insertMany(items) { for (const item of items) { unique(name, item); records[name].push({ ...item }); } return { insertedCount: items.length }; },
      async updateOne(query, changes, options) { return write(query, changes, options); },
      async updateMany(query, changes) { const rows = records[name].filter((item) => matches(item, query)); rows.forEach((item) => apply(item, changes)); return { modifiedCount: rows.length }; },
      async findOneAndUpdate(query, changes, options) { return write(query, changes, options).item || null; },
      async deleteOne(query) { const index = records[name].findIndex((item) => matches(item, query)); if (index >= 0) records[name].splice(index, 1); return { deletedCount: index >= 0 ? 1 : 0 }; },
      async deleteMany(query) { const before = records[name].length; records[name] = records[name].filter((item) => !matches(item, query)); return { deletedCount: before - records[name].length }; }
    };
  } };
}
module.exports = { memoryDb };
