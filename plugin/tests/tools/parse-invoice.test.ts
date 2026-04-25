import { describe, it, expect } from 'vitest'
import { parseInvoiceLine, suggestCategory, parseInvoice } from '../../src/tools/parse-invoice.js'

const FIXTURE_LINES = [
  '02/04PAGAMENTOEFETUADO5174- 1.340,84',
  '22/09AMAZONMARKETPLACE07/1052,29',
  '15/02LUIZABARCELOS- M03/0399,16',
  '25/03NACERFCLINICAVET01/03842,34',
  '06/04PET SHOPPORTALDO M150,00',
  '14/04NETFLIXENTRETENIMENTO44,90',
  '16/11PG *PRIVALIAPRIV 07/10152,08',
  '18/04ENCARGOSDE ATRASO72,94',
  '06/04Amazonweb services50,41',
  '20/03PETLOVESAUD*Petl80,00',
  '21/03LATAMAIR*CCWALA105,02',
]

describe('parseInvoiceLine', () => {
  it('parses a payment line (negative amount)', () => {
    const result = parseInvoiceLine('02/04PAGAMENTOEFETUADO5174- 1.340,84')
    expect(result).not.toBeNull()
    expect(result!.date).toBe('02/04')
    expect(result!.isPayment).toBe(true)
    expect(result!.amount).toBeCloseTo(1340.84)
    expect(result!.installment).toBeNull()
  })

  it('parses a line with installment', () => {
    const result = parseInvoiceLine('22/09AMAZONMARKETPLACE07/1052,29')
    expect(result).not.toBeNull()
    expect(result!.date).toBe('22/09')
    expect(result!.installment).toBe('07/10')
    expect(result!.amount).toBeCloseTo(52.29)
    expect(result!.isPayment).toBe(false)
  })

  it('parses a line with installment containing dash', () => {
    const result = parseInvoiceLine('15/02LUIZABARCELOS- M03/0399,16')
    expect(result).not.toBeNull()
    expect(result!.date).toBe('15/02')
    expect(result!.amount).toBeCloseTo(99.16)
  })

  it('parses a vet clinic line', () => {
    const result = parseInvoiceLine('25/03NACERFCLINICAVET01/03842,34')
    expect(result).not.toBeNull()
    expect(result!.date).toBe('25/03')
    expect(result!.amount).toBeCloseTo(842.34)
    expect(result!.installment).toBe('01/03')
  })

  it('parses a pet shop line', () => {
    const result = parseInvoiceLine('06/04PET SHOPPORTALDO M150,00')
    expect(result).not.toBeNull()
    expect(result!.date).toBe('06/04')
    expect(result!.amount).toBe(150)
    expect(result!.isPayment).toBe(false)
  })

  it('parses netflix line', () => {
    const result = parseInvoiceLine('14/04NETFLIXENTRETENIMENTO44,90')
    expect(result).not.toBeNull()
    expect(result!.date).toBe('14/04')
    expect(result!.amount).toBeCloseTo(44.90)
  })

  it('parses encargos line', () => {
    const result = parseInvoiceLine('18/04ENCARGOSDE ATRASO72,94')
    expect(result).not.toBeNull()
    expect(result!.date).toBe('18/04')
    expect(result!.amount).toBeCloseTo(72.94)
  })

  it('returns null for non-transaction lines', () => {
    expect(parseInvoiceLine('RESUMO DA FATURA')).toBeNull()
    expect(parseInvoiceLine('Vencimento: 15/05/2026')).toBeNull()
    expect(parseInvoiceLine('')).toBeNull()
    expect(parseInvoiceLine('Total: 1.234,56')).toBeNull()
  })

  it('parses AWS line (mixed case)', () => {
    const result = parseInvoiceLine('06/04Amazonweb services50,41')
    expect(result).not.toBeNull()
    expect(result!.amount).toBeCloseTo(50.41)
  })
})

describe('suggestCategory', () => {
  it('maps Amazon to Shopping', () => {
    expect(suggestCategory('AMAZONMARKETPLACE')).toBe('Shopping')
  })

  it('maps PET SHOP to Pet', () => {
    expect(suggestCategory('PET SHOPPORTALDO M')).toBe('Pet')
  })

  it('maps PETLOVE to Pet', () => {
    expect(suggestCategory('PETLOVESAUD*Petl')).toBe('Pet')
  })

  it('maps NACER*VET to Pet', () => {
    expect(suggestCategory('NACERFCLINICAVET')).toBe('Pet')
  })

  it('maps NETFLIX to Streaming', () => {
    expect(suggestCategory('NETFLIXENTRETENIMENTO')).toBe('Streaming')
  })

  it('maps LATAM to Transport', () => {
    expect(suggestCategory('LATAMAIR*CCWALA')).toBe('Transport')
  })

  it('maps AWS to Technology', () => {
    expect(suggestCategory('Amazonweb services')).toBe('Technology')
  })

  it('maps PAGAMENTO to payment', () => {
    expect(suggestCategory('PAGAMENTOEFETUADO5174')).toBe('payment')
  })

  it('maps ENCARGOS to charge', () => {
    expect(suggestCategory('ENCARGOSDE ATRASO')).toBe('charge')
  })

  it('returns null for unknown merchants', () => {
    expect(suggestCategory('MERCEARIA DO ZE')).toBeNull()
  })
})

describe('parseInvoice', () => {
  const FIXTURE_TEXT = `
CARTAO DE CREDITO
1234.XXXX.XXXX.9435VISA

Titular: JOHN DOE

Vencimento: 15/05/2026
Emissão: 10/04/2026

LANCAMENTOS

${FIXTURE_LINES.join('\n')}

Total: 1.580,00
`

  it('extracts due date', () => {
    const result = parseInvoice(FIXTURE_TEXT)
    expect(result.dueDate).toBe('2026-05-15')
  })

  it('extracts closing date', () => {
    const result = parseInvoice(FIXTURE_TEXT)
    expect(result.closingDate).toBe('2026-04-10')
  })

  it('detects card type Visa', () => {
    const result = parseInvoice(FIXTURE_TEXT)
    expect(result.card).toBe('Visa')
  })

  it('extracts card number', () => {
    const result = parseInvoice(FIXTURE_TEXT)
    expect(result.cardNumber).toBe('9435')
  })

  it('extracts billing cycle from closing date', () => {
    const result = parseInvoice(FIXTURE_TEXT)
    expect(result.billingCycle).toBe('2026-04')
  })

  it('excludes payment lines from items (they are not saved as expenses)', () => {
    const result = parseInvoice(FIXTURE_TEXT)
    // Payment lines (PAGAMENTO EFETUADO) are skipped — only expenses and charges go into items
    const payments = result.items.filter(i => i.isPayment)
    expect(payments.length).toBe(0)
  })

  it('marks charge items correctly', () => {
    const result = parseInvoice(FIXTURE_TEXT)
    const charges = result.items.filter(i => i.isCharge)
    expect(charges.length).toBeGreaterThan(0)
  })

  it('assigns cost_center Me for non-Lilian holder', () => {
    const result = parseInvoice(FIXTURE_TEXT)
    const normal = result.items.find(i => !i.isPayment && !i.isCharge)
    expect(normal?.cost_center).toBe('Me')
  })

  it('assigns cost_center Lilian for Lilian holder', () => {
    const lilianText = FIXTURE_TEXT.replace('JOHN DOE', 'JANE DOE')
    const result = parseInvoice(lilianText)
    const normal = result.items.find(i => !i.isPayment && !i.isCharge)
    expect(normal?.cost_center).toBe('Lilian')
  })

  it('calculates isoDate correctly with year rollover', () => {
    // closing date is April 2026; transaction in September (month 9 > 4) should be 2025
    const result = parseInvoice(FIXTURE_TEXT)
    const septItem = result.items.find(i => i.date === '22/09')
    expect(septItem).toBeDefined()
    expect(septItem!.isoDate).toBe('2025-09-22')
  })

  it('calculates isoDate for same-year months', () => {
    // transaction in March (month 3 <= closing month 4) should be 2026
    const result = parseInvoice(FIXTURE_TEXT)
    const marchItem = result.items.find(i => i.date === '25/03')
    expect(marchItem).toBeDefined()
    expect(marchItem!.isoDate).toBe('2026-03-25')
  })

  it('attaches due_date and billing_cycle to each item', () => {
    const result = parseInvoice(FIXTURE_TEXT)
    const item = result.items.find(i => !i.isPayment && !i.isCharge)
    expect(item?.due_date).toBe('2026-05-15')
    expect(item?.billing_cycle).toBe('2026-04')
  })

  it('returns all parsed lines as items', () => {
    const result = parseInvoice(FIXTURE_TEXT)
    // Fixture has 11 lines; payment lines are excluded from items, so 10 remain (11 - 1 payment)
    expect(result.items.length).toBe(FIXTURE_LINES.length - 1)
  })
})
