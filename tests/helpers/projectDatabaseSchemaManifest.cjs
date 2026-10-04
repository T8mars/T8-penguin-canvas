const crypto = require('node:crypto');
const { PROJECT_DATABASE_SCHEMA_33_OWNED_OBJECT_NAMES } = require('../../backend/src/services/projectDatabaseMigration33');

// Test-side implementation of the frozen schema-manifest algorithm. It is
// deliberately independent from projectDatabase.js so lineage fixtures cannot
// pass merely because production inspection and the test share one function.
function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(',')}]`;
  if (!value || typeof value !== 'object') return JSON.stringify(value);
  return `{${Object.keys(value).sort().map((key) => (
    `${JSON.stringify(key)}:${stableJson(value[key])}`
  )).join(',')}}`;
}

function sqlitePragmaString(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function tokenizeSchemaSql(value) {
  const sql = String(value || '').trim();
  const tokens = [];
  for (let index = 0; index < sql.length;) {
    const character = sql[index];
    if (/\s/.test(character)) {
      index += 1;
      continue;
    }
    if (character === '-' && sql[index + 1] === '-') {
      index += 2;
      while (index < sql.length && sql[index] !== '\n' && sql[index] !== '\r') index += 1;
      continue;
    }
    if (character === '/' && sql[index + 1] === '*') {
      const end = sql.indexOf('*/', index + 2);
      index = end < 0 ? sql.length : end + 2;
      continue;
    }
    if (character === "'" || character === '"' || character === '`' || character === '[') {
      const closing = character === '[' ? ']' : character;
      let token = character;
      index += 1;
      while (index < sql.length) {
        token += sql[index];
        if (sql[index] === closing) {
          if (character !== '[' && sql[index + 1] === closing) {
            token += sql[index + 1];
            index += 2;
            continue;
          }
          index += 1;
          break;
        }
        index += 1;
      }
      tokens.push(token);
      continue;
    }
    if (/[A-Za-z0-9_.$]/.test(character)) {
      let end = index + 1;
      while (end < sql.length && /[A-Za-z0-9_.$]/.test(sql[end])) end += 1;
      tokens.push(sql.slice(index, end).toLowerCase());
      index = end;
      continue;
    }
    const operator = ['->>', '<=', '>=', '<>', '!=', '==', '||', '<<', '>>', '->']
      .find((candidate) => sql.startsWith(candidate, index));
    if (operator) {
      tokens.push(operator);
      index += operator.length;
      continue;
    }
    if (character !== ';' || sql.slice(index + 1).trim()) tokens.push(character);
    index += 1;
  }
  return tokens;
}

function normalizeSchemaSql(value) {
  if (value == null) return null;
  return tokenizeSchemaSql(value).join(' ');
}

function schemaSqlAfterKeyword(value, keywords) {
  const tokens = tokenizeSchemaSql(value);
  const candidates = Array.isArray(keywords) ? keywords : [keywords];
  for (let index = 0; index < tokens.length; index += 1) {
    const candidate = candidates.find((keyword) => {
      const parts = String(keyword).toLowerCase().split(/\s+/);
      return parts.every((part, offset) => tokens[index + offset] === part);
    });
    if (candidate) return tokens.slice(index).join(' ');
  }
  return tokens.join(' ');
}

function extractCheckConstraints(value) {
  const tokens = tokenizeSchemaSql(value);
  const checks = [];
  for (let index = 0; index < tokens.length - 1; index += 1) {
    if (tokens[index] !== 'check' || tokens[index + 1] !== '(') continue;
    let depth = 1;
    let cursor = index + 2;
    for (; cursor < tokens.length && depth > 0; cursor += 1) {
      if (tokens[cursor] === '(') depth += 1;
      if (tokens[cursor] === ')') depth -= 1;
    }
    if (depth !== 0) {
      checks.push(tokens.slice(index + 2).join(' '));
      break;
    }
    checks.push(tokens.slice(index + 2, cursor - 1).join(' '));
    index = cursor - 1;
  }
  return checks.sort();
}

function inspectProjectDatabaseSchemaManifest(database, options = {}) {
  const includedObjectNames = options.includedObjectNames == null
    ? null
    : new Set([...options.includedObjectNames].map(String));
  const excludedObjectNames = options.excludedObjectNames == null
    ? new Set()
    : new Set([...options.excludedObjectNames].map(String));
  // A frozen historical descriptor inspects its own base contract only when
  // the new extension is actually recorded. Full descriptor33 includes it.
  if (Number(options.descriptorVersion || 0) <= 32
    && database.prepare("SELECT 1 FROM sqlite_master WHERE name='schema_migrations'").get()
    && database.prepare('SELECT 1 FROM schema_migrations WHERE version=33').get()) {
    for (const name of PROJECT_DATABASE_SCHEMA_33_OWNED_OBJECT_NAMES) excludedObjectNames.add(name);
  }
  const includesObject = (name) => (
    !excludedObjectNames.has(String(name))
    && (includedObjectNames == null || includedObjectNames.has(String(name)))
  );
  const objects = database.prepare(`
    SELECT type, name, tbl_name, sql
    FROM sqlite_master
    WHERE type IN ('table', 'index', 'trigger', 'view')
      AND name NOT LIKE 'sqlite_%'
    ORDER BY type ASC, name ASC
  `).all().filter((entry) => includesObject(entry.name));
  const tables = objects.filter((entry) => entry.type === 'table');
  const explicitIndexes = objects.filter((entry) => entry.type === 'index');
  const triggers = objects.filter((entry) => entry.type === 'trigger');
  const views = objects.filter((entry) => entry.type === 'view');
  const sqlByObjectName = new Map(objects.map((entry) => [String(entry.name), entry.sql]));
  const tableFlags = new Map(database.pragma('table_list')
    .filter((entry) => entry.schema === 'main' && !String(entry.name).startsWith('sqlite_'))
    .map((entry) => [String(entry.name), entry]));

  const tableDescriptors = tables.map((table) => {
    const tableName = String(table.name);
    const tableSql = table.sql == null ? null : String(table.sql);
    const flags = tableFlags.get(tableName) || {};
    const columns = database.pragma(`table_xinfo(${sqlitePragmaString(tableName)})`)
      .map((column) => ({
        cid: Number(column.cid),
        name: String(column.name),
        type: String(column.type || '').trim().toUpperCase(),
        notnull: Number(column.notnull) || 0,
        default: normalizeSchemaSql(column.dflt_value),
        primaryKey: Number(column.pk) || 0,
        hidden: Number(column.hidden) || 0,
      }))
      .sort((left, right) => left.cid - right.cid || left.name.localeCompare(right.name));

    const foreignKeyGroups = new Map();
    for (const foreignKey of database.pragma(`foreign_key_list(${sqlitePragmaString(tableName)})`)) {
      const key = Number(foreignKey.id) || 0;
      if (!foreignKeyGroups.has(key)) foreignKeyGroups.set(key, []);
      foreignKeyGroups.get(key).push(foreignKey);
    }
    const foreignKeys = [...foreignKeyGroups.values()].map((group) => {
      const ordered = group.sort((left, right) => Number(left.seq) - Number(right.seq));
      return {
        table: String(ordered[0]?.table || ''),
        onUpdate: String(ordered[0]?.on_update || '').toUpperCase(),
        onDelete: String(ordered[0]?.on_delete || '').toUpperCase(),
        match: String(ordered[0]?.match || '').toUpperCase(),
        columns: ordered.map((entry) => ({
          from: entry.from == null ? null : String(entry.from),
          to: entry.to == null ? null : String(entry.to),
        })),
      };
    }).sort((left, right) => stableJson(left).localeCompare(stableJson(right)));

    const indexes = database.pragma(`index_list(${sqlitePragmaString(tableName)})`)
      .filter((index) => String(index.origin) !== 'c' || includesObject(index.name))
      .map((index) => {
        const indexName = String(index.name);
        const columnsForIndex = database.pragma(`index_xinfo(${sqlitePragmaString(indexName)})`)
          .filter((column) => Number(column.key) === 1)
          .sort((left, right) => Number(left.seqno) - Number(right.seqno))
          .map((column) => ({
            name: column.name == null ? null : String(column.name),
            cid: column.name == null ? Number(column.cid) : null,
            descending: Number(column.desc) || 0,
            collation: column.coll == null ? null : String(column.coll),
            key: Number(column.key) || 0,
          }));
        const indexTokens = tokenizeSchemaSql(sqlByObjectName.get(indexName));
        const whereIndex = indexTokens.indexOf('where');
        const firstParen = indexTokens.indexOf('(');
        const hasExpression = columnsForIndex.some((column) => column.cid === -2);
        return {
          name: String(index.origin) === 'c' ? indexName : null,
          unique: Number(index.unique) || 0,
          origin: String(index.origin || ''),
          partial: Number(index.partial) || 0,
          columns: columnsForIndex,
          expressionDefinition: hasExpression && firstParen >= 0
            ? indexTokens.slice(firstParen).join(' ')
            : null,
          where: whereIndex >= 0 ? indexTokens.slice(whereIndex + 1).join(' ') : null,
        };
      }).sort((left, right) => stableJson(left).localeCompare(stableJson(right)));

    const tableTokens = tokenizeSchemaSql(tableSql);
    const tableDefinitionStart = tableTokens.indexOf('(');
    return {
      name: tableName,
      kind: String(flags.type || 'table'),
      withoutRowid: Number(flags.wr) || 0,
      strict: Number(flags.strict) || 0,
      definition: String(flags.type || '') !== 'virtual' && tableDefinitionStart >= 0
        ? tableTokens.slice(tableDefinitionStart).join(' ')
        : null,
      columns,
      foreignKeys,
      indexes,
      checks: extractCheckConstraints(tableSql),
      autoincrement: tableTokens.includes('autoincrement'),
      virtualDefinition: String(flags.type || '') === 'virtual'
        ? schemaSqlAfterKeyword(tableSql, 'using')
        : null,
    };
  }).sort((left, right) => left.name.localeCompare(right.name));

  const descriptor = {
    version: Number(options.descriptorVersion),
    counts: {
      tables: tables.length,
      indexes: explicitIndexes.length,
      triggers: triggers.length,
      views: views.length,
    },
    tables: tableDescriptors,
    triggers: triggers.map((trigger) => ({
      name: String(trigger.name),
      table: String(trigger.tbl_name),
      definition: schemaSqlAfterKeyword(trigger.sql, ['before', 'after', 'instead of']),
    })).sort((left, right) => left.name.localeCompare(right.name)),
    views: views.map((view) => ({
      name: String(view.name),
      definition: schemaSqlAfterKeyword(view.sql, 'as'),
    })).sort((left, right) => left.name.localeCompare(right.name)),
  };
  return {
    descriptor,
    counts: descriptor.counts,
    fingerprint: crypto.createHash('sha256').update(stableJson(descriptor)).digest('hex'),
  };
}

module.exports = Object.freeze({
  inspectProjectDatabaseSchemaManifest,
  stableJson,
});
