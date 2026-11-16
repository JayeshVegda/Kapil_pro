import { createFileRoute } from '@tanstack/react-router'
import { CompanyReportPage } from './monthly-report'

export const Route = createFileRoute('/company-report')({ component: CompanyReportPage })
