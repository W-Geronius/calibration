/*
 * Copyright 2018 Teppo Kurki <teppo.kurki@iki.fi>
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

const linearInterpolator = require('linear-interpolator')
module.exports = function (app) {
  const error =
    app.error ||
    (msg => {
      console.error(msg)
    })
  const debug =
    app.debug ||
    (msg => {
      console.log(msg)
    })

  const plugin = {}
  const unsubscribes = []
  const lastConversions = {}

  plugin.start = function (props) {
    props.calibrations &&
      props.calibrations.forEach(calibration => {
        if (calibration.mappings.length > 1) {
          calibration.mappings.sort((a, b) => a.in - b.in)

          const period = parseFloat(calibration.period)
          const decimals = parseInt(calibration.decimals)
          debug(`path:${calibration.path} sourceRef:${calibration.sourceRef} decimals: ${calibration.decimals}, period:${calibration.period}`)

          let previousOut = Number.MIN_VALUE
          const convert = linearInterpolator(
            calibration.mappings.reduce((acc, mapping) => {
              let out = mapping.out
              if (!isNaN(period) && out < previousOut) {
                out += (Math.floor(previousOut / period) + 1) * period
              }

              debug(`${mapping.in} => ${out}(${mapping.out})`)
              acc.push([mapping.in, out])
              previousOut = out
              return acc
            }, [])
          )
          let compareSource = () => true
          if (typeof calibration.sourceRef !== 'undefined') {
            compareSource = (sourceRef) => sourceRef === calibration.sourceRef
          }
          unsubscribes.push(
            app.registerDeltaInputHandler((delta, next) => {
              delta.updates &&
                delta.updates.forEach(update => {
                  update.values &&
                    update.values.forEach(pathValue => {
                      if (pathValue.path === calibration.path && compareSource(update.$source)) {
                        let result = convert(pathValue.value)
                        if (!isNaN(period)) {
                          result = (result / period) % 1 * period
                        }
                        let calibrated = result
                        if (!isNaN(decimals)){
                          result = parseFloat(result.toFixed(decimals))
                        }
                        lastConversions[calibration.path] = {
                          in: pathValue.value,
                          out: result
                        }
                        if (debug.enabled) {
                          debug(`${pathValue.path}(${update.$source}) ${pathValue.value} => ${result} (${calibrated}))`)
                        }
                        pathValue.value = result
                      }
                    })
                })
              next(delta)
            })
          )
        }
      })
    //always save on start so that the data is stored sorted
    app.savePluginOptions(props, () => { })
  }

  plugin.stop = function () { }

  plugin.statusMessage = function () {
    return Object.keys(lastConversions)
      .map(key => `${key}: ${lastConversions[key].in} => ${lastConversions[key].out}`)
      .toString()
  }

  plugin.id = 'calibration'
  plugin.name = 'Calibration'
  plugin.description =
    'Plugin that uses linear interpolation to adjust incoming deltas in the server for calibrating inputs'

  plugin.schema = {
    type: 'object',
    properties: {
      calibrations: {
        type: 'array',
        items: {
          type: 'object',
          required: ['path', 'mappings'],
          properties: {
            path: {
              type: 'string'
            },
            sourceRef: {
              type: 'string'
            },
            decimals: {
              type: 'number'
            },
            period: {
              type: 'number'
            },
            mappings: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  in: {
                    type: 'number'
                  },
                  out: {
                    type: 'number'
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  return plugin
}
