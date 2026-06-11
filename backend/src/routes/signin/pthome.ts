import { makeStandardNexusPhpSignin } from './standardNexusPhp.js'

export const pthomeSignin = makeStandardNexusPhpSignin({
  matchDomains: ['pthome.net', 'www.pthome.net']
})
