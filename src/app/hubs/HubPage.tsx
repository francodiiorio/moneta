import type { ReactNode } from 'react'
import { useSearchParams } from 'react-router'
import { PageHeader } from '@/components/PageHeader'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

export interface HubTab {
  value: string
  label: string
  content: ReactNode
}

interface HubPageProps {
  title: string
  /** The first one is the default; the open tab lives in the URL
   *  (?tab=cuentas), so a link or a reload lands on it. */
  tabs: readonly HubTab[]
}

/** One section of the app made of several feature pages, one per tab —
 *  composed here, in app/, so no feature imports another's components. */
export function HubPage({ title, tabs }: HubPageProps) {
  const [searchParams, setSearchParams] = useSearchParams()
  const current = tabs.find((t) => t.value === searchParams.get('tab')) ?? tabs[0]!

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={title} />
      <Tabs
        value={current.value}
        onValueChange={(value) => setSearchParams(value === tabs[0]!.value ? {} : { tab: value }, { replace: true })}
      >
        <TabsList>
          {tabs.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value}>
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
        {/* Only the open tab is mounted: each is its own page, with its
            own queries and dialogs. */}
        <TabsContent key={current.value} value={current.value}>
          {current.content}
        </TabsContent>
      </Tabs>
    </div>
  )
}
