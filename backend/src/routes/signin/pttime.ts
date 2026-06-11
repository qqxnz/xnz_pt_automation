import { makeStandardNexusPhpSignin } from './standardNexusPhp.js'

export const pttimeSignin = makeStandardNexusPhpSignin({
  matchDomains: ['pttime.org', 'www.pttime.org']
})
