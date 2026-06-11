import { makeStandardNexusPhpSignin } from './standardNexusPhp.js'

export const ourbitsSignin = makeStandardNexusPhpSignin({
  matchDomains: ['ourbits.club', 'www.ourbits.club']
})
