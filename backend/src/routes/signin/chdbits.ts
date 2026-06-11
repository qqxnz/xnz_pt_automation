import { makeStandardNexusPhpSignin } from './standardNexusPhp.js'

export const chdbitsSignin = makeStandardNexusPhpSignin({
  matchDomains: ['ptchdbits.co', 'www.ptchdbits.co']
})
