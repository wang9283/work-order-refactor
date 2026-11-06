import { useCallback, useEffect, useRef, useState } from 'react'
import type { BusinessCatalogItem, OrgReferenceData, SiteBusinessConfig } from '@contracts/index'
import { api, errorMessage } from '@next/shared/api'
import { useAuth } from '@next/shared/auth'

export function useBusinessScope() {
  const { activeBase, contextVersion } = useAuth()
  const [org, setOrg] = useState<OrgReferenceData | null>(null)
  const [catalog, setCatalog] = useState<BusinessCatalogItem[]>([])
  const [config, setConfig] = useState<SiteBusinessConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const requestId = useRef(0)
  const reload = useCallback(async () => {
    const current = ++requestId.current
    setLoading(true); setError('')
    try {
      const [nextOrg, nextCatalog] = await Promise.all([api.get<OrgReferenceData>('/org/tree'), api.get<BusinessCatalogItem[]>('/business-catalogs')])
      const nextSiteId = activeBase?.id
      const nextConfig = nextSiteId ? await api.get<SiteBusinessConfig>(`/sites/${encodeURIComponent(nextSiteId)}/business-config`) : null
      if (current !== requestId.current) return
      setOrg(nextOrg); setCatalog(nextCatalog); setConfig(nextConfig)
    } catch (reason) { if (current === requestId.current) setError(errorMessage(reason)) }
    finally { if (current === requestId.current) setLoading(false) }
  }, [activeBase?.id, contextVersion])
  useEffect(() => { void reload(); return () => { requestId.current += 1 } }, [reload])
  return { org, catalog, siteId: activeBase?.id, config, loading, error, reload,
    sites: activeBase ? [activeBase] : [] }
}
