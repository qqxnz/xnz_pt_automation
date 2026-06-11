import { makeStandardNexusPhpSignin } from './standardNexusPhp.js'

export const pterclubSignin = makeStandardNexusPhpSignin({
  matchDomains: ['pterclub.net', 'pterclub.com', 'www.pterclub.com'],
  signinPath: '/attendance-ajax.php',
  responseType: 'json',
  jsonStatusKey: 'status',
  jsonStatusSuccessValue: '1',
  jsonRepeatValue: '0',
  detailExtractor: (text) => {
    const match = text.match(/(\d+)\s*克猫粮/)
    return match?.[1]
  },
  successMessageBuilder: (displayName, text) => {
    const match = text.match(/(\d+)\s*克猫粮/)
    const detail = match?.[1] ? `（${match[1]} 克猫粮）` : ''
    return `${displayName} 签到成功${detail}`
  }
})
