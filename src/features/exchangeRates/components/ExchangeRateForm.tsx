import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { todayStamp } from '@/lib/dates'
import { EXCHANGE_RATE_CURRENCIES, exchangeRateFormSchema, type ExchangeRateFormValues } from '../schema'
import { createExchangeRateFromForm } from '../service'

const DEFAULT_VALUES: ExchangeRateFormValues = {
  date: todayStamp(),
  from: 'USD',
  to: 'ARS',
  rate: '',
}

export function ExchangeRateForm() {
  const form = useForm<ExchangeRateFormValues>({
    resolver: zodResolver(exchangeRateFormSchema),
    defaultValues: DEFAULT_VALUES,
  })

  async function onSubmit(values: ExchangeRateFormValues) {
    try {
      await createExchangeRateFromForm(values)
      toast.success('Tasa cargada')
      form.reset({ ...DEFAULT_VALUES, from: values.from, to: values.to })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo cargar la tasa')
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Nueva tasa</CardTitle>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4 sm:grid-cols-4 sm:items-end">
            <FormField
              control={form.control}
              name="date"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Fecha</FormLabel>
                  <FormControl>
                    <Input type="date" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="from"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>De</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {EXCHANGE_RATE_CURRENCIES.map((code) => (
                        <SelectItem key={code} value={code}>
                          {code}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="to"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>A</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {EXCHANGE_RATE_CURRENCIES.map((code) => (
                        <SelectItem key={code} value={code}>
                          {code}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="rate"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Tasa</FormLabel>
                  <FormControl>
                    <Input inputMode="decimal" placeholder="Ej: 1.200,00" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="sm:col-span-4">
              <Button type="submit" disabled={form.formState.isSubmitting}>
                Agregar tasa
              </Button>
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>
  )
}
