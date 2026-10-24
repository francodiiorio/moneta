import {
  accountAdjustmentsRepo,
  accountsRepo,
  categoriesRepo,
  creditCardsRepo,
  expensesRepo,
  incomesRepo,
  investmentLotsRepo,
  investmentsRepo,
  statementPaymentsRepo,
  transfersRepo,
} from '@/database/repositories'
import type { Account, Category, CategoryKind, Expense } from '@/domain/entities'
import { money, negate, parseAmount, type Money } from '@/domain/money'
import { statementPeriodFor, type CardCalendar } from '@/domain/cards'
import { formatMonthLabel, monthRange, type DateStamp, type MonthStamp } from '@/lib/dates'
import { invariant } from '@/lib/invariant'
import type { ExpenseFormValues, IncomeFormValues, MovementFormValues, MovementKind, TransferFormValues } from './schema'

export interface TransactionFilters {
  categoryId?: string
  accountId?: string
}

/** What a Movimientos row can be: what the form creates (gasto, ingreso,
 *  transferencia), plus three things listed so every change to an account
 *  balance is visible here: an "Ajustar saldo" adjustment (created from
 *  Cuentas, only deleted here), an investment purchase paid from an
 *  account (created and edited in Patrimonio, read-only here) and a card
 *  statement payment (paid and undone in Tarjetas, read-only here). */
export type TransactionKind = MovementKind | 'transfer' | 'adjustment' | 'investment' | 'cardPayment'

export const ADJUSTMENT_LABEL = 'Ajuste de saldo'
export const TRANSFER_LABEL = 'Transferencia'
export const INVESTMENT_LABEL = 'Compra de inversión'
export const CARD_PAYMENT_LABEL = 'Pago de tarjeta'

/** Both sides of a transfer row, as stored — what the edit form needs. */
export interface TransferDetails {
  fromAccountId: string
  toAccountId: string
  fromAmount: Money
  toAmount: Money
}

export interface TransactionListItem {
  id: string
  kind: TransactionKind
  date: DateStamp
  createdAt: string
  description: string
  status: Expense['status']
  /** Signed for display: a gasto is negated (every stored amount is a
   *  positive magnitude, see CLAUDE.md "Reglas financieras") so
   *  `MoneyText`'s `signColor` reads it as money that left; an ingreso
   *  stays positive. Never write this value back — the save path
   *  re-derives the magnitude from the form. */
  amount: Money
  /** Whether `amount`'s sign means "entered/left an account" — false for
   *  an adjustment (a correction, not money moving) and for an
   *  unfiltered transfer (it's neither in nor out overall), so the row
   *  doesn't color them as income/expense. */
  signed: boolean
  /** For a cross-currency transfer: the other side's amount, shown next
   *  to `amount` so both real figures are visible. */
  counterpart?: Money
  /** '' for an adjustment or transfer — they have no category. */
  categoryId: string
  categoryLabel?: string
  categoryColor?: string
  categoryIcon?: string
  accountId?: string
  /** The account, card ("Visa · resumen de octubre 2026") or both
   *  accounts of a transfer ("Galicia → Caja USD"). */
  accountLabel?: string
  /** For a gasto paid with a credit card, and for a statement payment
   *  (with the period it paid). */
  cardId?: string
  statementPeriod?: MonthStamp
  /** True when the gasto sits in a statement other than the one its date
   *  puts it in (a late presentation the user pinned) — the edit form then
   *  keeps it pinned; otherwise it offers "según la fecha". */
  statementPinned?: boolean
  /** Only for kind 'transfer'. */
  transfer?: TransferDetails
}

/** A row the Movimientos form can edit — anything but an adjustment. */
export type EditableTransactionItem = TransactionListItem & { kind: MovementKind | 'transfer' }

export function isEditableTransaction(item: TransactionListItem): item is EditableTransactionItem {
  return item.kind !== 'adjustment' && item.kind !== 'investment' && item.kind !== 'cardPayment'
}

/** Gastos, ingresos, transferencias and saldo adjustments of `month`,
 *  merged newest-first. Only gastos can be `projected` — nothing else has
 *  plans that project it forward.
 *
 *  A transfer's `amount` depends on the account filter: filtered to its
 *  origin it's the negated `fromAmount` (money that left), to its
 *  destination the `toAmount` (money that came in); unfiltered it's the
 *  unsigned `fromAmount` — it isn't income nor expense overall. */
export async function listTransactionsForMonth(
  month: MonthStamp,
  filters: TransactionFilters = {},
): Promise<TransactionListItem[]> {
  const { start, end } = monthRange(month)
  const [expenses, incomes, adjustments, transfers, lots, payments, assets, categories, accounts, cards] = await Promise.all([
    expensesRepo.listExpensesInRange(start, end),
    incomesRepo.listIncomesInRange(start, end),
    accountAdjustmentsRepo.listAdjustmentsInRange(start, end),
    transfersRepo.listTransfersInRange(start, end),
    investmentLotsRepo.listLotsWithSourceInRange(start, end),
    statementPaymentsRepo.listStatementPaymentsInRange(start, end),
    investmentsRepo.listInvestmentAssets(),
    categoriesRepo.listCategories(),
    accountsRepo.listAccounts(),
    creditCardsRepo.listCreditCards(),
  ])
  const cardName = new Map(cards.map((c) => [c.id, c.name]))
  const calendars = new Map<string, CardCalendar>()
  for (const cardId of new Set(expenses.flatMap((e) => (e.cardId ? [e.cardId] : [])))) {
    calendars.set(cardId, await creditCardsRepo.getCardCalendar(cardId))
  }

  const categoryById = new Map(categories.map((c) => [c.id, c] as [string, Category]))
  const accountById = new Map(accounts.map((a) => [a.id, a] as [string, Account]))

  function decorate(categoryId: string, accountId: string | undefined) {
    const category = categoryById.get(categoryId)
    const account = accountId !== undefined ? accountById.get(accountId) : undefined
    return {
      categoryId,
      ...(category?.name !== undefined && { categoryLabel: category.name }),
      ...(category?.color !== undefined && { categoryColor: category.color }),
      ...(category?.icon !== undefined && { categoryIcon: category.icon }),
      ...(accountId !== undefined && { accountId }),
      ...(account !== undefined && { accountLabel: account.name }),
    }
  }

  const items: TransactionListItem[] = [
    ...expenses.map((expense) => ({
      id: expense.id,
      kind: 'expense' as const,
      date: expense.date,
      createdAt: expense.createdAt,
      description: expense.description,
      status: expense.status,
      amount: negate(money(expense.amount, expense.currency)),
      signed: true,
      ...decorate(expense.categoryId, expense.accountId),
      ...(expense.cardId !== undefined &&
        expense.statementPeriod !== undefined && {
          cardId: expense.cardId,
          statementPeriod: expense.statementPeriod,
          statementPinned: (() => {
            const calendar = calendars.get(expense.cardId)
            return calendar !== undefined && statementPeriodFor(calendar, expense.date) !== expense.statementPeriod
          })(),
          accountLabel: `${cardName.get(expense.cardId) ?? 'Tarjeta'} · resumen de ${formatMonthLabel(expense.statementPeriod).toLowerCase()}`,
        }),
    })),
    ...incomes.map((income) => ({
      id: income.id,
      kind: 'income' as const,
      date: income.date,
      createdAt: income.createdAt,
      description: income.description,
      status: 'confirmed' as const,
      amount: money(income.amount, income.currency),
      signed: true,
      ...decorate(income.categoryId, income.accountId),
    })),
    ...adjustments.map((adjustment) => ({
      id: adjustment.id,
      kind: 'adjustment' as const,
      date: adjustment.date,
      createdAt: adjustment.createdAt,
      description: adjustment.description ?? ADJUSTMENT_LABEL,
      status: 'confirmed' as const,
      amount: money(adjustment.amount, adjustment.currency),
      signed: false,
      ...decorate('', adjustment.accountId),
      categoryLabel: ADJUSTMENT_LABEL,
    })),
    ...transfers.map((transfer) => {
      const fromAmount = money(transfer.fromAmount, transfer.fromCurrency)
      const toAmount = money(transfer.toAmount, transfer.toCurrency)
      const isInbound = filters.accountId === transfer.toAccountId
      const isOutbound = filters.accountId === transfer.fromAccountId
      const amount = isInbound ? toAmount : isOutbound ? negate(fromAmount) : fromAmount
      const crossCurrency = transfer.fromCurrency !== transfer.toCurrency
      const fromName = accountById.get(transfer.fromAccountId)?.name ?? '—'
      const toName = accountById.get(transfer.toAccountId)?.name ?? '—'
      return {
        id: transfer.id,
        kind: 'transfer' as const,
        date: transfer.date,
        createdAt: transfer.createdAt,
        description: transfer.description,
        status: 'confirmed' as const,
        amount,
        signed: isInbound || isOutbound,
        ...(crossCurrency && { counterpart: isInbound ? fromAmount : toAmount }),
        categoryId: '',
        categoryLabel: TRANSFER_LABEL,
        accountId: transfer.fromAccountId,
        accountLabel: `${fromName} → ${toName}`,
        transfer: {
          fromAccountId: transfer.fromAccountId,
          toAccountId: transfer.toAccountId,
          fromAmount,
          toAmount,
        },
      }
    }),
    ...lots.flatMap((lot) => {
      if (lot.sourceAccountId === undefined || lot.sourceAmount === undefined || lot.sourceCurrency === undefined) {
        return []
      }
      const asset = assets.find((a) => a.id === lot.assetId)
      return [
        {
          id: lot.id,
          kind: 'investment' as const,
          date: lot.date,
          createdAt: lot.createdAt,
          description: `Compra de ${asset?.symbol ?? asset?.name ?? 'un activo'}`,
          status: 'confirmed' as const,
          amount: negate(money(lot.sourceAmount, lot.sourceCurrency)),
          signed: true,
          ...decorate('', lot.sourceAccountId),
          categoryLabel: INVESTMENT_LABEL,
        },
      ]
    }),
    // One row per currency paid: each is its own debit, maybe from
    // different accounts. Never a gasto — the purchases already were.
    ...payments.map((payment) => ({
      id: payment.id,
      kind: 'cardPayment' as const,
      date: payment.date,
      createdAt: payment.createdAt,
      description: `Resumen ${cardName.get(payment.cardId) ?? 'de tarjeta'} de ${formatMonthLabel(payment.period).toLowerCase()}`,
      status: 'confirmed' as const,
      amount: negate(money(payment.debitedAmount, payment.debitedCurrency)),
      signed: true,
      ...(payment.currency !== payment.debitedCurrency && { counterpart: money(payment.amount, payment.currency) }),
      ...decorate('', payment.accountId),
      categoryLabel: CARD_PAYMENT_LABEL,
      cardId: payment.cardId,
      statementPeriod: payment.period,
    })),
  ]

  return items
    .filter((item) => !filters.categoryId || item.categoryId === filters.categoryId)
    .filter(
      (item) =>
        !filters.accountId || item.accountId === filters.accountId || item.transfer?.toAccountId === filters.accountId,
    )
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))
}

export async function saveExpense(values: ExpenseFormValues, existingId?: string): Promise<void> {
  const amount = parseAmount(values.amount, values.currency)
  invariant(amount.amount > 0, 'El monto debe ser mayor a cero')
  await expensesRepo.saveExpense(
    {
      date: values.date,
      description: values.description,
      categoryId: values.categoryId,
      amount: amount.amount,
      currency: values.currency,
      status: 'confirmed',
      ...(values.accountId && { accountId: values.accountId }),
      ...(values.cardId && { cardId: values.cardId }),
      ...(values.cardId && values.statementPeriod && { statementPeriod: values.statementPeriod }),
    },
    existingId,
  )
}

export async function saveIncome(values: IncomeFormValues, existingId?: string): Promise<void> {
  const amount = parseAmount(values.amount, values.currency)
  invariant(amount.amount > 0, 'El monto debe ser mayor a cero')
  await incomesRepo.saveIncome(
    {
      date: values.date,
      description: values.description,
      categoryId: values.categoryId,
      accountId: values.accountId,
      amount: amount.amount,
      currency: values.currency,
    },
    existingId,
  )
}

export async function saveMovement(values: MovementFormValues, existingId?: string): Promise<void> {
  const { kind, ...rest } = values
  if (kind === 'income') {
    await saveIncome(rest, existingId)
  } else {
    await saveExpense(rest, existingId)
  }
}

/** Each amount is parsed in its own account's currency — the accounts
 *  are read here, never trusted from the form. Between two accounts of
 *  the same currency only one amount is asked for, so it's used on both
 *  sides (and the repository re-checks they match). */
export async function saveTransferFromForm(
  values: TransferFormValues,
  existingId?: string,
  /** The currencies the form showed for each side — what the user typed
   *  the amounts in. The repository rejects the write if an account's
   *  currency changed since (see transfers.repo.ts). */
  displayed?: { from: string; to: string },
): Promise<void> {
  const [from, to] = await Promise.all([
    accountsRepo.getAccount(values.fromAccountId),
    accountsRepo.getAccount(values.toAccountId),
  ])
  invariant(from, `Cuenta no encontrada: ${values.fromAccountId}`)
  invariant(to, `Cuenta no encontrada: ${values.toAccountId}`)

  const fromCurrency = displayed?.from ?? from.currency
  const toCurrency = displayed?.to ?? to.currency
  const fromAmount = parseAmount(values.fromAmount, fromCurrency).amount
  const sameCurrency = fromCurrency === toCurrency
  invariant(sameCurrency || values.toAmount.trim() !== '', `Ingresá cuánto entró en ${toCurrency}`)
  const toAmount = sameCurrency ? fromAmount : parseAmount(values.toAmount, toCurrency).amount
  invariant(fromAmount > 0 && toAmount > 0, 'Los montos tienen que ser mayores a cero')

  await transfersRepo.saveTransfer(
    {
      date: values.date,
      fromAccountId: from.id,
      toAccountId: to.id,
      fromAmount,
      toAmount,
      description: values.description.trim() || TRANSFER_LABEL,
      expectedFromCurrency: fromCurrency,
      expectedToCurrency: toCurrency,
    },
    existingId,
  )
}

export async function removeTransaction(id: string, kind: TransactionKind): Promise<void> {
  if (kind === 'income') {
    await incomesRepo.deleteIncome(id)
  } else if (kind === 'transfer') {
    await transfersRepo.deleteTransfer(id)
  } else if (kind === 'investment') {
    invariant(false, 'Una compra de inversión se edita o borra desde Patrimonio')
  } else if (kind === 'cardPayment') {
    invariant(false, 'Un pago de resumen se deshace desde Tarjetas')
  } else if (kind === 'adjustment') {
    await accountAdjustmentsRepo.deleteAdjustment(id)
  } else {
    await expensesRepo.deleteExpense(id)
  }
}

// Archived categories can't be picked for a *new* movement, but a past
// one that already used one still shows its name — see
// listAllCategories, used by the Movimientos filter, which is unfiltered.
export function listCategories(kind: CategoryKind): Promise<Category[]> {
  return categoriesRepo.listActiveCategories(kind)
}

export async function listAllCategories(): Promise<Category[]> {
  return categoriesRepo.listCategories()
}

export async function createCategoryQuick(name: string, kind: CategoryKind): Promise<Category> {
  return categoriesRepo.createCategory({ name, kind })
}

/** Every credit card, archived included — same picker rule as accounts. */
export async function listAllCards() {
  return creditCardsRepo.listCreditCards()
}

/** Every account, archived included — the picker offers only active ones
 *  for a new movement, but editing one that already points at an
 *  archived account has to keep showing it. */
export async function listAllAccounts(): Promise<Account[]> {
  return accountsRepo.listAccounts()
}
