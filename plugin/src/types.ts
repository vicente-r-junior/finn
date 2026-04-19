// All shared interfaces for the Finn finance agent

export type TransactionType = 'expense' | 'income' | 'card_payment'
export type CostCenter = 'Me' | 'Lilian'
export type CardName = 'Mastercard' | 'Visa' | 'Aeternum' | 'Itaú' | 'Bradesco' | 'Nu' | 'C6'
export type MediaSource = 'text' | 'audio' | 'pdf' | 'image'
export type ConversationStateType = 'idle' | 'awaiting_confirm' | 'awaiting_edit_confirm'

export const COST_CENTERS: CostCenter[] = ['Me', 'Lilian']
export const CARDS: CardName[] = ['Mastercard', 'Visa', 'Aeternum', 'Itaú', 'Bradesco', 'Nu', 'C6']
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
}

export interface Transaction extends PendingTransaction {
  id: string
  phone: string
  created_at: string
  updated_at: string
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
