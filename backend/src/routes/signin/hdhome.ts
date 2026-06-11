import { makeStandardNexusPhpSignin } from './standardNexusPhp.js'

export const hdhomeSignin = makeStandardNexusPhpSignin({
  matchDomains: ['hdhome.org', 'www.hdhome.org']
})
