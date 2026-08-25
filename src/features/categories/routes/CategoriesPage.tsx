import { Link } from 'react-router'
import { ChevronLeft, Plus, Tag } from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import { EmptyState } from '@/components/EmptyState'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { Category } from '@/domain/entities'
import { useCategories } from '../hooks/useCategories'
import { useCategoriesUiStore } from '../store'
import { CategoryFormDialog } from '../components/CategoryFormDialog'
import { CategoryTree } from '../components/CategoryTree'

export function CategoriesPage() {
  const categories = useCategories()
  const { tab, setTab, dialogOpen, editingCategoryId, openCreateDialog, openEditDialog, closeDialog } =
    useCategoriesUiStore()

  const editingCategory = categories?.find((c) => c.id === editingCategoryId)
  const hasAnyForTab = categories?.some((c) => c.kind === tab)

  return (
    <div className="flex flex-col gap-4">
      <Link to="/ajustes" className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="size-4" />
        Ajustes
      </Link>

      <PageHeader
        title="Categorías"
        description="Organizá tus gastos e ingresos."
        actions={
          <Button onClick={openCreateDialog}>
            <Plus className="size-4" />
            Nueva categoría
          </Button>
        }
      />

      <Tabs value={tab} onValueChange={(v) => setTab(v as Category['kind'])}>
        <TabsList>
          <TabsTrigger value="expense">Gastos</TabsTrigger>
          <TabsTrigger value="income">Ingresos</TabsTrigger>
        </TabsList>
      </Tabs>

      {categories === undefined ? (
        <div className="h-40 animate-pulse rounded-xl bg-muted" />
      ) : !hasAnyForTab ? (
        <EmptyState
          icon={Tag}
          title="No hay categorías todavía"
          description="Creá una para poder clasificar tus movimientos."
          action={<Button onClick={openCreateDialog}>Nueva categoría</Button>}
        />
      ) : (
        <CategoryTree kind={tab} categories={categories} onEdit={openEditDialog} />
      )}

      <CategoryFormDialog
        open={dialogOpen}
        category={editingCategory}
        defaultKind={tab}
        onOpenChange={(open) => (open ? undefined : closeDialog())}
      />
    </div>
  )
}
