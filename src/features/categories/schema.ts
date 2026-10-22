import { z } from 'zod'
import { categoryKindSchema } from '@/domain/entities'

export const categoryFormSchema = z.object({
  name: z.string().min(1, 'El nombre es obligatorio').max(60),
  kind: categoryKindSchema,
  parentId: z.string(), // '' = sin padre (categoría de nivel superior)
  color: z.string(), // '' = sin color
  icon: z.string(), // '' = sin ícono
})
export type CategoryFormValues = z.infer<typeof categoryFormSchema>
