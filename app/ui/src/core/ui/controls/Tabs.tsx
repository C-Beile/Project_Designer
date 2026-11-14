import type { ReactNode } from 'react'
import { Tab, TabList, TabPanel, Tabs as AriaTabs, type TabsProps as AriaTabsProps } from 'react-aria-components'

export interface TabItem {
  id: string
  label: string
  content: ReactNode
}

export interface TabsProps extends Omit<AriaTabsProps, 'className' | 'children'> {
  tabs: TabItem[]
  ariaLabel: string
}

export function Tabs({ tabs, ariaLabel, ...props }: TabsProps) {
  return (
    <AriaTabs {...props} className="ui-Tabs">
      <TabList aria-label={ariaLabel} className="ui-TabList">
        {tabs.map((t) => (
          <Tab key={t.id} id={t.id} className="ui-Tab">
            {t.label}
          </Tab>
        ))}
      </TabList>
      {tabs.map((t) => (
        <TabPanel key={t.id} id={t.id} className="ui-TabPanel">
          {t.content}
        </TabPanel>
      ))}
    </AriaTabs>
  )
}
