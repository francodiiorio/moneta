import { create } from 'zustand'

export type NetWorthTab = 'summary' | 'savings' | 'investments' | 'quotes'

/** UI-only state — net worth *data* always comes from useLiveQuery. */
interface NetWorthUiState {
  tab: NetWorthTab
  setTab: (tab: NetWorthTab) => void

  savingsDialogOpen: boolean
  editingSavingsId: string | null
  openCreateSavingsDialog: () => void
  openEditSavingsDialog: (id: string) => void
  closeSavingsDialog: () => void

  assetDialogOpen: boolean
  openAssetDialog: () => void
  closeAssetDialog: () => void

  // Crear una posición nueva o agregar otra compra a una existente —
  // InvestmentLotFormDialog en modo "crear" (nunca "editar": editar una
  // compra puntual es estado interno de InvestmentLotsDialog, más abajo).
  lotDialogOpen: boolean
  /** Pre-selects (y bloquea) el activo — "Agregar posición" desde una
   *  fila que ya tiene una, o desde un activo que todavía no tiene
   *  ninguna. Null cuando se crea desde "Nueva posición" en el menú, sin
   *  activo preelegido. */
  newLotAssetId: string | null
  openCreateLotDialog: (assetId?: string) => void
  closeLotDialog: () => void

  /** Qué posición se está administrando (lista de compras) — abierto por
   *  el lápiz de un InvestmentRow. Null cierra InvestmentLotsDialog. Ver
   *  ADR "Tracking de inversiones por lote" en docs/DECISIONS.md. */
  managingLotsAssetId: string | null
  openManageLotsDialog: (assetId: string) => void
  closeManageLotsDialog: () => void

  /** Which asset's price is being loaded — null when the dialog is closed. */
  pricingAssetId: string | null
  openPriceDialog: (assetId: string) => void
  closePriceDialog: () => void

  rateDialogOpen: boolean
  openRateDialog: () => void
  closeRateDialog: () => void
}

export const useNetWorthUiStore = create<NetWorthUiState>((set) => ({
  tab: 'summary',
  setTab: (tab) => set({ tab }),

  savingsDialogOpen: false,
  editingSavingsId: null,
  openCreateSavingsDialog: () => set({ savingsDialogOpen: true, editingSavingsId: null }),
  openEditSavingsDialog: (id) => set({ savingsDialogOpen: true, editingSavingsId: id }),
  closeSavingsDialog: () => set({ savingsDialogOpen: false, editingSavingsId: null }),

  assetDialogOpen: false,
  openAssetDialog: () => set({ assetDialogOpen: true }),
  closeAssetDialog: () => set({ assetDialogOpen: false }),

  lotDialogOpen: false,
  newLotAssetId: null,
  openCreateLotDialog: (assetId) => set({ lotDialogOpen: true, newLotAssetId: assetId ?? null }),
  closeLotDialog: () => set({ lotDialogOpen: false, newLotAssetId: null }),

  managingLotsAssetId: null,
  openManageLotsDialog: (assetId) => set({ managingLotsAssetId: assetId }),
  closeManageLotsDialog: () => set({ managingLotsAssetId: null }),

  pricingAssetId: null,
  openPriceDialog: (assetId) => set({ pricingAssetId: assetId }),
  closePriceDialog: () => set({ pricingAssetId: null }),

  rateDialogOpen: false,
  openRateDialog: () => set({ rateDialogOpen: true }),
  closeRateDialog: () => set({ rateDialogOpen: false }),
}))
