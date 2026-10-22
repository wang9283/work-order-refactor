import { hashPassword } from '../core/password'

console.log(hashPassword(process.argv[2] || 'Feed2026!'))
