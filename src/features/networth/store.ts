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

  holdingDialogOpen: boolean
  editingHoldingId: string | null
  openCreateHoldingDialog: () => void
  openEditHoldingDialog: (id: string) => void
  closeHoldingDialog: () => void

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

  holdingDialogOpen: false,
  editingHoldingId: null,
  openCreateHoldingDialog: () => set({ holdingDialogOpen: true, editingHoldingId: null }),
  openEditHoldingDialog: (id) => set({ holdingDialogOpen: true, editingHoldingId: id }),
  closeHoldingDialog: () => set({ holdingDialogOpen: false, editingHoldingId: null }),

  pricingAssetId: null,
  openPriceDialog: (assetId) => set({ pricingAssetId: assetId }),
  closePriceDialog: () => set({ pricingAssetId: null }),

  rateDialogOpen: false,
  openRateDialog: () => set({ rateDialogOpen: true }),
  closeRateDialog: () => set({ rateDialogOpen: false }),
}))
