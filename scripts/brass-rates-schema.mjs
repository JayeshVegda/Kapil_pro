const API_RULE = '@request.auth.id != ""'

export const brassRateFields = [
  dateField('date', true),
  numberField('vilaity', true),
  numberField('honey_gulf'),
  numberField('honey_europe'),
  textField('source'),
  textField('note'),
  textField('weekday'),
  textField('bulletin_time'),
  textField('rss_guid'),
  textField('rss_link'),
  textField('raw_text'),
  textField('jamnagar_trend'),
  textField('honey_gulf_trend'),
  textField('honey_europe_trend'),
  textField('vilaity_trend'),
  textField('zinc_trend'),
  numberField('plant_pass'),
  textField('plant_pass_trend'),
  numberField('zinc_9995'),
  textField('zinc_9995_trend'),
  numberField('delhi_honey'),
  textField('delhi_honey_trend'),
  numberField('delhi_local'),
  textField('delhi_local_trend'),
  numberField('armature'),
  textField('armature_trend'),
  textField('mcx_status'),
  numberField('mcx_copper'),
  textField('mcx_copper_trend'),
  numberField('mcx_zinc'),
  textField('mcx_zinc_trend'),
  numberField('lme_3m'),
  textField('lme_3m_trend'),
  numberField('usd_inr'),
  textField('usd_inr_trend'),
  dateField('telegram_sent_at'),
  textField('weekly_report_included'),
]

export const brassRateIndexes = ['CREATE UNIQUE INDEX idx_brass_rates_date ON brass_rates (date)']

export async function ensureBrassRatesCollection(pb) {
  const existing = await pb.collections.getOne('brass_rates').catch(() => null)
  if (!existing) {
    await pb.collections.create({
      name: 'brass_rates',
      type: 'base',
      fields: brassRateFields,
      indexes: brassRateIndexes,
      listRule: API_RULE,
      viewRule: API_RULE,
      createRule: API_RULE,
      updateRule: API_RULE,
      deleteRule: API_RULE,
    })
    return 'created'
  }

  await pb.collections.update(existing.id, {
    ...existing,
    fields: mergeFields(existing.fields ?? [], brassRateFields),
    indexes: brassRateIndexes,
    listRule: API_RULE,
    viewRule: API_RULE,
    createRule: API_RULE,
    updateRule: API_RULE,
    deleteRule: API_RULE,
  })
  return 'updated'
}

function mergeFields(existingFields, desiredFields) {
  const desiredNames = new Set(desiredFields.map((field) => field.name))
  const keep = existingFields.filter((field) => field?.system || !desiredNames.has(field?.name))
  return [...keep, ...desiredFields]
}

function dateField(name, required = false) {
  return {
    name,
    type: 'date',
    required,
    options: { min: '', max: '' },
  }
}

function numberField(name, required = false) {
  return {
    name,
    type: 'number',
    required,
    onlyInt: false,
    min: null,
    max: null,
  }
}

function textField(name, required = false) {
  return {
    name,
    type: 'text',
    required,
    min: 0,
    max: 0,
    pattern: '',
    autogeneratePattern: '',
  }
}
