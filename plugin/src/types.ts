// All shared interfaces for the Finn finance agent

export type TransactionType = 'expense' | 'income' | 'card_payment'
export type CostCenter = 'Me' | 'Lilian'
export type CardName = string
export type MediaSource = 'text' | 'audio' | 'pdf' | 'image'
export type ConversationStateType = 'idle' | 'awaiting_confirm' | 'awaiting_edit_confirm'

export const COST_CENTERS: CostCenter[] = ['Me', 'Lilian']
export const CARDS: string[] = ['Mastercard', 'Visa', 'Aeternum', 'Itaú', 'Bradesco', 'Nu', 'C6']
export const KNOWN_CARDS: string[] = ['Mastercard', 'Visa', 'Aeternum', 'Itaú', 'Bradesco', 'Nu', 'C6']
export const CASH_KEYWORDS = ['pix', 'dinheiro', 'débito', 'debito', 'cash', 'especie', 'espécie']
export const DEFAULT_CARD: CardName = 'Mastercard'

export interface PendingTransaction {
  type: TransactionType
  amount: number
  description: string
  category: string
  cost_center: CostCenter
  card: CardName | null
  date: string           // ISO: YYYY-MM-DD
  source: MediaSource
  raw_input: string
  due_date?: string | null      // YYYY-MM-DD
  billing_cycle?: string | null // YYYY-MM
}

export interface Transaction extends PendingTransaction {
  id: string
  phone: string
  created_at: string
  updated_at: string
  due_date?: string | null
  billing_cycle?: string | null
}

export interface InvoiceItem {
  date: string           // DD/MM from invoice
  isoDate: string        // YYYY-MM-DD (inferred using invoice year)
  description: string    // raw merchant name
  installment: string | null  // e.g. "07/10"
  amount: number
  isPayment: boolean     // true = skip (negative)
  isCharge: boolean      // true = skip (ENCARGOS, JUROS, MULTA)
  category: string | null     // auto-suggested
  cost_center: 'Me' | 'Lilian'   // from cardholder name
  card: string           // 'Visa', 'Mastercard', 'Aeternum'
  cardHolder: string     // raw name from PDF
  due_date: string       // YYYY-MM-DD from invoice
  billing_cycle: string  // YYYY-MM
}

export interface ParsedInvoice {
  card: string           // 'Visa' | 'Mastercard' | 'Aeternum'
  cardNumber: string     // partial e.g. '9435'
  holderName: string
  dueDate: string        // YYYY-MM-DD
  billingCycle: string   // YYYY-MM
  closingDate: string    // YYYY-MM-DD
  totalAmount: number
  items: InvoiceItem[]   // all items including skipped ones
}

export interface ConversationStateRow {
  phone: string
  state: ConversationStateType
  pending_transaction: PendingTransaction | null
  target_transaction_id: string | null
  history: ChatMessage[]
  updated_at: string
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface VocabularyEntry {
  id: string
  phone: string
  term: string
  category: string
  card: CardName | null
  cost_center: CostCenter | null
  confidence: number
}

export interface CreditCard {
  id: string
  name: CardName
  due_day: number
  closing_day: number | null
  is_default: boolean
}

export interface Category {
  id: string
  name: string
}

export interface AgentInput {
  phone: string
  message: string
  mediaType?: MediaSource
  mediaData?: string   // base64 for audio/image, raw text for pdf
}

export interface AgentResult {
  reply: string
}
