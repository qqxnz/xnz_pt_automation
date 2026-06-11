import { makeStandardNexusPhpSignin } from './standardNexusPhp.js'

export const hdkylSignin = makeStandardNexusPhpSignin({
  matchDomains: ['hdkyl.in', 'www.hdkyl.in']
})
