import { Storage } from '../storage'
import signalSources from '../signal_sources'
import { HttpHeaderSignalSource } from '../common_types'
import { escapeHtml, HttpResponse } from '../utils'
import { clientHintHeaders as resultDelayChHeaders } from './wait_result_frame'

/**
 * Makes a URL that the browser will request if the signal activates
 */
type SignalActivationUrlFactory = (visitId: string, signalKey: string, signalValue: string) => string

/**
 * Makes a URL that the browser will request anyway for the backend to read the headers
 */
type HeaderProbeUrlFactory = (visitId: string, resourceType: HttpHeaderSignalSource['resourceType']) => string

/**
 * Makes a URL of the iframe to show the result
 */
type ResultUrlFactory = (visitId: string) => string

export const resultDelayClassName = 'resultDelay'

/**
 * The main page that makes browser send HTTP requests that reveal information about the browser
 */
export default async function renderMainPage(
  storage: Storage,
  getSignalActivationUrl: SignalActivationUrlFactory,
  getHeaderProbeUrl: HeaderProbeUrlFactory,
  getResultFrameUrl: ResultUrlFactory,
): Promise<HttpResponse> {
  const visitId = await storage.createVisit()
  const codeForCssSignalSources = makeCodeForCssSignalSources(visitId, getSignalActivationUrl)

  const body = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
    <meta http-equiv="X-UA-Compatible" content="IE=edge" />
    <title>No-JavaScript fingerprinting</title>
    <style>
${codeForCssSignalSources.css.join('\n')}
    </style>
    <link rel="stylesheet" href="${escapeHtml(getHeaderProbeUrl(visitId, 'style'))}" />
  </head>
  <body>
    <h1>No-JS fingerprinting</h1>
    <div>
      <iframe src="${escapeHtml(getResultFrameUrl(visitId))}"></iframe>
    </div>
    <noscript>
      <div>
        <img src="https://media.makeameme.org/created/it-is-magic-5b4cb3.jpg" alt="It's magic" style="max-width: 100%;" />
      </div>
    </noscript>
    <div style="position: absolute; top: 0; left: -9999px;">
      <img src="${escapeHtml(getHeaderProbeUrl(visitId, 'image'))}" alt="" />
      <video src="${escapeHtml(getHeaderProbeUrl(visitId, 'video'))}"></video>
      <audio src="${escapeHtml(getHeaderProbeUrl(visitId, 'audio'))}"></audio>
${codeForCssSignalSources.html.join('\n')}
    </div>
  </body>
</html>`

  return {
    body,
    headers: {
      'Accept-CH': [...resultDelayChHeaders, ...getClientHintHeaders()].join(', '),
      'Content-Type': 'text/html; charset=utf-8',
    },
  }
}

function makeCodeForCssSignalSources(visitId: string, getSignalActivationUrl: SignalActivationUrlFactory) {
  const css: string[] = []
  const html: string[] = []
  let probeCount = 0

  for (const signalSource of signalSources) {
    switch (signalSource.type) {
      case 'css': {
        const className = `css_probe_${++probeCount}`
        const style = `background: url('${getSignalActivationUrl(visitId, signalSource.key, '')}')`
        html.push(`<div class="${escapeHtml(className)}"></div>`)
        css.push(signalSource.getCss(className, style))
        break
      }
      case 'cssMediaEnum': {
        const className = `css_probe_${++probeCount}`
        html.push(`<div class="${escapeHtml(className)}"></div>`)
        for (const value of signalSource.mediaValues) {
          const style = `background: url('${getSignalActivationUrl(visitId, signalSource.key, value)}')`
          css.push(`@media (${signalSource.mediaName}: ${value}) { .${className} { ${style} } }`)
        }
        break
      }
      case 'cssMediaNumber': {
        const className = `css_probe_${++probeCount}`
        html.push(`<div class="${escapeHtml(className)}"></div>`)

        let previousBreakpoint: number | undefined
        const makeCssRule = (min: number | undefined, max: number | undefined) => {
          const { key, mediaName, vendorPrefix = '', valueUnit = '' } = signalSource
          const activationUrl = getSignalActivationUrl(
            visitId,
            key,
            [min, max].map((value) => (value === undefined ? '' : String(value))).join(','),
          )
          return (
            '@media ' +
            (min === undefined ? '' : `(${vendorPrefix}min-${mediaName}: ${min}${valueUnit})`) +
            (min === undefined || max === undefined ? '' : ' and ') +
            (max === undefined ? '' : `(${vendorPrefix}max-${mediaName}: ${max - 0.00001}${valueUnit})`) +
            ` { .${className} { background: url('${activationUrl}') } }`
          )
        }

        for (const breakpoint of signalSource.getRangeBreakpoints()) {
          css.push(makeCssRule(previousBreakpoint, breakpoint))
          previousBreakpoint = breakpoint
        }
        if (previousBreakpoint !== undefined) {
          css.push(makeCssRule(previousBreakpoint, undefined))
        }
        break
      }
      case 'fontAbsence': {
        html.push(`<div style="font-family: '${signalSource.fontName}'">a</div>`)
        css.push(
          '@font-face { ' +
            `font-family: '${signalSource.fontName}'; ` +
            `src: local('${signalSource.fontName}'), ` +
            `url('${getSignalActivationUrl(visitId, signalSource.key, '')}') format('truetype') }`,
        )
        break
      }
    }
  }

  return { css, html }
}

function getClientHintHeaders() {
  const names: string[] = []
  for (const signalSource of signalSources) {
    if (signalSource.type === 'httpHeader' && signalSource.isClientHint) {
      names.push(signalSource.headerName)
    }
  }
  return names
}