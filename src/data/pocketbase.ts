import PocketBase from 'pocketbase'
import { getPocketBaseUrl } from '@/app/env'

const baseUrl = getPocketBaseUrl()

export const pb = new PocketBase(baseUrl)
pb.autoCancellation(false)
