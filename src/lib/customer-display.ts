function clean(value: unknown) {
  return String(value ?? '').trim()
}

export function formatCompanyName(companyName: unknown, customerName: unknown) {
  return clean(companyName) || clean(customerName) || 'Unknown'
}

export function formatCustomerDisplayName(companyName: unknown, customerName: unknown) {
  const company = clean(companyName)
  const customer = clean(customerName)
  if (!company) return customer || 'Unknown'
  if (!customer) return company
  if (company.toLowerCase() === customer.toLowerCase()) return company
  return `${company} (${customer})`
}
