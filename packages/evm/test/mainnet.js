const { ethers, network } = require('hardhat')
const Asset = require('./Asset')
const { expect } = require('chai')
const { toBn } = require('./math')

const config = require('../config/mainnet')

describe('MultipriceOracle', function () {
  const weth = new Asset(config.weth, 18)
  const wbtc = new Asset('0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', 8)
  const usdc = new Asset('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', 6)
  const snx = new Asset('0xC011a73ee8576Fb46F5E1c5751cA3B9Fe0af2a6F', 18)
  const yfi = new Asset('0x0bc529c00C6401aEF6D220BE8C6Ea1667F6Ad93e', 18)
  const oneinch = new Asset('0x111111111117dc0aa78b770fa6a738034120c302', 18)

  let oracle

  before('Ensure fork node', () => {
    expect(network.config, 'has fork node configured').to.have.nested.property('forking.url').that.exists
    expect(network.config, 'using fork node').to.have.nested.property('forking.enabled').that.is.true
  })

  before('Ensure configuration', async () => {
    const expectedContracts = [
      config.chainLinkRegistry,
      config.uniswapV3Factory,
      config.uniswapV3Oracle,
      config.uniswapV2Factory,
      config.sushiswapFactory,
      config.weth,
      ...config.usdEquivalents,
    ]
    for (const contract of expectedContracts) {
      expect(
        await ethers.provider.getCode(contract),
        `expected contract at ${contract} is indeed contract`
      ).to.not.equal('0x')
    }

    expect([toBn('500'), toBn('3000'), toBn('10000')]).to.deep.include(toBn(config.uniswapV3PoolFee))
  })

  before('Deploy MultipriceOracle', async () => {
    const MultipriceOracle = await ethers.getContractFactory('MultipriceOracle')
    oracle = await MultipriceOracle.deploy(
      config.chainLinkRegistry,
      config.uniswapV3Factory,
      config.uniswapV3PoolFee,
      config.uniswapV3Oracle,
      config.uniswapV2Factory,
      config.sushiswapFactory,
      config.weth,
      config.usdEquivalents
    )
    await oracle.deployed()
  })

  it('was deployed correctly', async () => {
    expect(await oracle.chainLinkRegistry()).to.addressEqual(config.chainLinkRegistry)
    expect(await oracle.uniswapV3Factory()).to.addressEqual(config.uniswapV3Factory)
    expect(await oracle.uniswapV3PoolFee()).to.equal(toBn(config.uniswapV3PoolFee))
    expect(await oracle.uniswapV3Oracle()).to.addressEqual(config.uniswapV3Oracle)
    expect(await oracle.uniswapV2Factory()).to.addressEqual(config.uniswapV2Factory)
    expect(await oracle.sushiswapFactory()).to.addressEqual(config.sushiswapFactory)
    expect(await oracle.weth()).to.addressEqual(config.weth)

    for (const usdEquivalent of config.usdEquivalents) {
      expect(await oracle.isUsdEquivalent(usdEquivalent)).to.be.true
    }
  })

  context('assetToAsset', () => {
    const defaultConfig = {
      clBuffer: '0', // no buffer
      twapPeriod: '1800', // 30min
      inclusionBitmap: 0b11111, // all enabled
    }

    function itQueriesTrade(name, { input, output, config, closeTo, additionalChecks }) {
      context(name, async () => {
        let outputs

        const { asset: assetIn, amount: amountIn } = input
        const {
          asset: assetOut,
          expectedSource: expectedOutputSource,
          expectedAmount: expectedAmount,
          buffer: expectedOutputBuffer,
        } = output
        const { clBuffer, twapPeriod, inclusionBitmap } = config
        const { sources: closeToSources, buffer: closeToBuffer } = closeTo || {}

        before('Run query', async () => {
          outputs = await oracle.assetToAsset(
            assetIn.address,
            assetIn.toAmountD(amountIn),
            assetOut.address,
            clBuffer,
            twapPeriod,
            inclusionBitmap
          )
        })

        it('matches query snapshot', () => {
          const outputToSnapshot = ['value', 'cl', 'clBuf', 'uniV3Twap', 'uniV3Spot', 'uniV2Spot', 'sushiSpot'].reduce(
            (agg, k) => {
              agg[k] = outputs[k].toString()
              return agg
            },
            {}
          )
          expect(outputToSnapshot).toMatchSnapshot()
        })

        it('matches expected amount', () => {
          const out = Number(assetOut.formatAmountD(outputs.value))
          expect(out).to.be.closeTo(expectedAmount, expectedOutputBuffer)
        })

        it(`matches expected price source (${expectedOutputSource})`, () => {
          expect(outputs.value).to.equal(outputs[expectedOutputSource])
        })

        if (Array.isArray(closeToSources) && closeToSources.length) {
          it(`is close to other price sources (${closeToSources})`, () => {
            // Check value is close to expected sources
            for (const source of closeToSources) {
              expect(outputs.value).to.be.closeTo(outputs[source], closeToBuffer)
            }
          })
        }

        if (typeof additionalChecks === 'function') {
          additionalChecks(() => outputs)
        }
      })
    }

    itQueriesTrade('usdc -> eth', {
      input: {
        asset: usdc,
        amount: 10000,
      },
      output: {
        asset: weth,
        expectedSource: 'cl',
        // 1 ETH ~= 2850 USDC
        expectedAmount: 3.51,
        buffer: 0.05,
      },
      config: defaultConfig,
      closeTo: {
        sources: ['cl', 'clBuf', 'uniV3Twap', 'uniV3Spot', 'uniV2Spot', 'sushiSpot'],
        buffer: weth.toAmountD('0.05'),
      },
    })

    itQueriesTrade('eth -> usdc', {
      input: {
        asset: weth,
        amount: 10,
      },
      output: {
        asset: usdc,
        expectedSource: 'uniV2Spot',
        // 1 ETH ~= 2850 USDC
        expectedAmount: 28500,
        buffer: 100,
      },
      config: defaultConfig,
      closeTo: {
        sources: ['cl', 'clBuf', 'uniV3Twap', 'uniV3Spot', 'uniV2Spot', 'sushiSpot'],
        buffer: usdc.toAmountD(100),
      },
    })

    itQueriesTrade('wbtc -> usdc', {
      input: {
        asset: wbtc,
        amount: 10,
      },
      output: {
        asset: usdc,
        expectedSource: 'uniV2Spot',
        // 1 WBTC ~= 40,000 USDC
        expectedAmount: 400000,
        buffer: 500,
      },
      config: defaultConfig,
      closeTo: {
        sources: ['cl', 'clBuf', 'uniV3Twap', 'uniV3Spot', 'uniV2Spot', 'sushiSpot'],
        buffer: usdc.toAmountD(2500),
      },
    })

    itQueriesTrade('usdc -> wbtc', {
      input: {
        asset: usdc,
        amount: 100000,
      },
      output: {
        asset: wbtc,
        expectedSource: 'cl',
        // 1 WBTC ~= 40,000 USDC
        expectedAmount: 2.5,
        buffer: 0.05,
      },
      config: defaultConfig,
      closeTo: {
        sources: ['cl', 'clBuf', 'uniV3Twap', 'uniV3Spot', 'uniV2Spot', 'sushiSpot'],
        buffer: wbtc.toAmountD('0.05'),
      },
    })

    context('chainlink buffer', () => {
      function additionalBufferChecks(getOutputs) {
        let outputs
        before('load context', () => {
          outputs = getOutputs()
        })
        it("output's clBuf is lower than cl", async () => {
          expect(outputs.clBuf).to.be.lt(outputs.cl)
        })
      }

      context('large buffer to force clBuf selection', async () => {
        itQueriesTrade('usdc -> wbtc', {
          input: {
            asset: wbtc,
            amount: 10,
          },
          output: {
            asset: usdc,
            expectedSource: 'clBuf',
            // 1 WBTC ~= 40,250 USDC; with 1% buffer ~= 39,850 USDC
            expectedAmount: 398500,
            buffer: 100,
          },
          config: {
            ...defaultConfig,
            clBuffer: ethers.utils.parseUnits('0.01', 'ether'), // 100 bps (1%)
          },
          additionalChecks: additionalBufferChecks,
        })
      })

      context('small buffer to pass clBuf', async () => {
        itQueriesTrade('usdc -> wbtc', {
          input: {
            asset: wbtc,
            amount: 10,
          },
          output: {
            asset: usdc,
            // ChainLink: 1 WBTC ~= 40,250 USDC; with 0.01% buffer ~= 40,245 USDC
            // UniV2 spot: 1 WBTC ~= 40,000 USDC
            expectedSource: 'uniV2Spot',
            expectedAmount: 400000,
            buffer: 500,
          },
          config: {
            ...defaultConfig,
            clBuffer: ethers.utils.parseUnits('0.0001', 'ether'), // 1 bps (0.01%)
          },
          additionalChecks: additionalBufferChecks,
        })
      })
    })

    context('twap window', () => {
      it('cannot query trades with 0 window', async () => {
        // See https://github.com/Uniswap/uniswap-v3-periphery/blob/main/contracts/libraries/OracleLibrary.sol#L18
        await expect(
          oracle.assetToAsset(
            usdc.address,
            usdc.toAmountD('1000'),
            weth.address,
            defaultConfig.clBuffer,
            0, // twap
            defaultConfig.inclusionBitmap
          )
        ).to.be.revertedWith('BP')
      })

      it('cannot query long twap windows on assets without enough v3 pool history', async () => {
        // See https://github.com/Uniswap/uniswap-v3-core/blob/main/contracts/libraries/Oracle.sol#L226
        await expect(
          oracle.assetToAsset(
            snx.address,
            snx.toAmountD('1000'),
            weth.address,
            defaultConfig.clBuffer,
            '1800', // twap; 30min
            defaultConfig.inclusionBitmap
          )
        ).to.be.revertedWith('OLD')
      })

      context('can query trades with short twap window', () => {
        itQueriesTrade('snx -> usdc', {
          input: {
            asset: snx,
            amount: 5000,
          },
          output: {
            asset: usdc,
            expectedSource: 'cl',
            // 1 SNX ~= 14.5 USDC
            expectedAmount: 72500,
            buffer: 500,
          },
          config: {
            ...defaultConfig,
            twapPeriod: '15', // 15sec
          },
          closeTo: {
            sources: ['cl', 'clBuf', 'uniV3Twap', 'uniV3Spot', 'uniV2Spot', 'sushiSpot'],
            buffer: usdc.toAmountD(750),
          },
        })
      })
    })

    context('inclusion bitmap', () => {
      it('does not allow queries with invalid inclusion bitmaps', async () => {
        await expect(
          oracle.assetToAsset(
            wbtc.address,
            wbtc.toAmountD('10'),
            wbtc.address,
            defaultConfig.clBuffer,
            defaultConfig.twapPeriod,
            0b100000 // anything higher than 0b11111 reverts
          )
        ).to.be.revertedWith('Inclusion bitmap invalid')
      })

      context('include only chainlink', () => {
        // Note that chainlink is the highest price (see snapshot), so it would normally never be chosen
        itQueriesTrade('wbtc -> usdc', {
          input: {
            asset: wbtc,
            amount: 10,
          },
          output: {
            asset: usdc,
            expectedSource: 'cl',
            // 1 WBTC ~= 40,250 USDC
            expectedAmount: 402500,
            buffer: 50,
          },
          config: {
            ...defaultConfig,
            inclusionBitmap: 0b00001, // only chainlink
          },
        })
      })

      context('include chainlink and uniV3 twap', () => {
        itQueriesTrade('wbtc -> usdc', {
          input: {
            asset: wbtc,
            amount: 10,
          },
          output: {
            asset: usdc,
            expectedSource: 'uniV3Twap',
            // 1 WBTC ~= 40,250 USDC
            expectedAmount: 402500,
            buffer: 250,
          },
          config: {
            ...defaultConfig,
            inclusionBitmap: 0b00011, // chainlink + uniV3Twap
          },
        })
      })

      context('include chainlink, uniV2 spot, uniV3 twap', () => {
        // Note that output decreases now, as uniV2Spot is at 40k instead of 40.25k
        itQueriesTrade('wbtc -> usdc', {
          input: {
            asset: wbtc,
            amount: 10,
          },
          output: {
            asset: usdc,
            expectedSource: 'uniV2Spot',
            // 1 WBTC ~= 40,000 USDC
            expectedAmount: 400000,
            buffer: 250,
          },
          config: {
            ...defaultConfig,
            inclusionBitmap: 0b01011, // chainlink + uniV3Twap + uniV2Spot
          },
        })
      })
    })
  })

  context('chainLinkAssetToAsset', () => {
    function itQueriesTrade(name, { input, output }) {
      it(name, async () => {
        const { asset: assetIn, amount: amountIn } = input
        const { asset: assetOut, expectedAmount, buffer } = output

        const outD = await oracle.chainLinkAssetToAsset(assetIn.address, assetIn.toAmountD(amountIn), assetOut.address)
        const out = Number(assetOut.formatAmountD(outD))

        expect(out).to.be.closeTo(expectedAmount, buffer)
      })
    }

    context('supported assets', () => {
      it('can query trades', () => {
        itQueriesTrade('usdc -> eth', {
          input: {
            asset: usdc,
            amount: 10000,
          },
          output: {
            asset: weth,
            // 1 ETH ~= 2850 USDC
            expectedAmount: 3.51,
            buffer: 0.05,
          },
        })

        itQueriesTrade('eth -> usdc', {
          input: {
            asset: weth,
            amount: 10,
          },
          output: {
            asset: usdc,
            // 1 ETH ~= 2850 USDC
            expectedAmount: 28500,
            buffer: 100,
          },
        })

        // ChainLink's WBTC was higher than DEX spot
        itQueriesTrade('wbtc -> usdc', {
          input: {
            asset: wbtc,
            amount: 10,
          },
          output: {
            asset: usdc,
            // 1 WBTC ~= 40,250 USDC
            expectedAmount: 402500,
            buffer: 500,
          },
        })

        itQueriesTrade('usdc -> wbtc', {
          input: {
            asset: usdc,
            amount: 100000,
          },
          output: {
            asset: wbtc,
            // 1 WBTC ~= 40,250 USDC
            expectedAmount: 2.485,
            buffer: 0.05,
          },
        })

        itQueriesTrade('snx -> wbtc (through usd:usd)', {
          input: {
            asset: snx,
            amount: 5000,
          },
          output: {
            asset: wbtc,
            // 1 WBTC ~= 40,000 USDC
            // 1 SNX ~= 14.5 USDC
            expectedAmount: 1.8125,
            buffer: 0.05,
          },
        })

        itQueriesTrade('wbtc -> snx (through usd:usd)', {
          input: {
            asset: wbtc,
            amount: 10,
          },
          output: {
            asset: snx,
            // 1 WBTC ~= 40,000 USDC
            // 1 SNX ~= 14.5 USDC
            expectedAmount: 27500,
            buffer: 100,
          },
        })

        itQueriesTrade('yfi -> wbtc (through eth:eth)', {
          input: {
            asset: yfi,
            amount: 10,
          },
          output: {
            asset: wbtc,
            // 1 WBTC ~= 40,000 USDC
            // 1 YFI ~= 50,000 USDC
            expectedAmount: 12.45,
            buffer: 0.05,
          },
        })

        itQueriesTrade('wbtc -> yfi (through eth:eth)', {
          input: {
            asset: wbtc,
            amount: 10,
          },
          output: {
            asset: yfi,
            // 1 WBTC ~= 40,000 USDC
            // 1 YFI ~= 50,000 USDC
            expectedAmount: 8.05,
            buffer: 0.05,
          },
        })
      })
    })

    context('unsupported assets', () => {
      // These assets (1INCH) do not have a corresponding chainlink feed in the aggregator
      it('cannot query trades', async () => {
        await expect(
          oracle.chainLinkAssetToAsset(oneinch.address, oneinch.toAmountD('1000'), weth.address)
        ).to.be.revertedWith('ChainLink rate not available')
      })
    })
  })

  context('uniV3TwapAssetToAsset', () => {
    function itQueriesTrade(name, { input, output, twapPeriod }) {
      it(name, async () => {
        const { asset: assetIn, amount: amountIn } = input
        const { asset: assetOut, expectedAmount, buffer } = output

        const outD = await oracle.uniV3TwapAssetToAsset(
          assetIn.address,
          assetIn.toAmountD(amountIn),
          assetOut.address,
          twapPeriod
        )
        const out = Number(assetOut.formatAmountD(outD))

        expect(out).to.be.closeTo(expectedAmount, buffer)
      })
    }

    it('cannot query trade with 0 window', async () => {
      // See https://github.com/Uniswap/uniswap-v3-periphery/blob/main/contracts/libraries/OracleLibrary.sol#L18
      await expect(
        oracle.uniV3TwapAssetToAsset(usdc.address, usdc.toAmountD('1000'), weth.address, 0)
      ).to.be.revertedWith('BP')
    })

    context('short twap window', () => {
      const twapPeriod = '15' // should be within a block

      // These trades should closely mirror current spot rates
      itQueriesTrade('usdc -> eth', {
        twapPeriod,
        input: {
          asset: usdc,
          amount: 10000,
        },
        output: {
          asset: weth,
          // 1 ETH ~= 2850 USDC
          expectedAmount: 3.51,
          buffer: 0.05,
        },
      })

      itQueriesTrade('eth -> usdc', {
        twapPeriod,
        input: {
          asset: weth,
          amount: 10,
        },
        output: {
          asset: usdc,
          // 1 ETH ~= 2850 USDC
          expectedAmount: 28500,
          buffer: 100,
        },
      })

      itQueriesTrade('wbtc -> usdc (through eth)', {
        twapPeriod,
        input: {
          asset: wbtc,
          amount: 10,
        },
        output: {
          asset: usdc,
          // 1 WBTC ~= 40,000 USDC
          expectedAmount: 400000,
          buffer: 1500,
        },
      })

      itQueriesTrade('usdc -> wbtc (through eth)', {
        twapPeriod,
        input: {
          asset: usdc,
          amount: 100000,
        },
        output: {
          asset: wbtc,
          // 1 WBTC ~= 40,000 USDC
          expectedAmount: 2.5,
          buffer: 0.1,
        },
      })

      itQueriesTrade('snx -> wbtc (through eth)', {
        twapPeriod,
        input: {
          asset: snx,
          amount: 5000,
        },
        output: {
          asset: wbtc,
          // 1 WBTC ~= 40,000 USDC
          // 1 SNX ~= 14.5 USDC
          expectedAmount: 1.8125,
          buffer: 0.15,
        },
      })

      itQueriesTrade('wbtc -> snx (through eth)', {
        twapPeriod,
        input: {
          asset: wbtc,
          amount: 10,
        },
        output: {
          asset: snx,
          // 1 WBTC ~= 40,000 USDC
          // 1 SNX ~= 14.5 USDC
          expectedAmount: 27500,
          buffer: 200,
        },
      })
    })

    context('long twap window', () => {
      const twapPeriod = '1800' // 30min

      context('assets with enough v3 pool history', () => {
        // WETH/USDC and WETH/WBTC pools already had their histories lengthened

        // WETH/USDC's 30min TWAP stayed close to spot
        itQueriesTrade('usdc -> eth', {
          twapPeriod,
          input: {
            asset: usdc,
            amount: 10000,
          },
          output: {
            asset: weth,
            // TWAP 1 ETH ~= 2850 USDC
            expectedAmount: 3.51,
            buffer: 0.05,
          },
        })

        itQueriesTrade('eth -> usdc', {
          twapPeriod,
          input: {
            asset: weth,
            amount: 10,
          },
          output: {
            asset: usdc,
            // TWAP 1 ETH ~= 2850 USDC
            expectedAmount: 28500,
            buffer: 100,
          },
        })

        // WBTC/USDC 30min TWAP was higher than spot
        itQueriesTrade('wbtc -> usdc (through eth)', {
          twapPeriod,
          input: {
            asset: wbtc,
            amount: 10,
          },
          output: {
            asset: usdc,
            // TWAP 1 WBTC ~= 40,250 USDC
            expectedAmount: 402500,
            buffer: 1000,
          },
        })

        itQueriesTrade('usdc -> wbtc (through eth)', {
          twapPeriod,
          input: {
            asset: usdc,
            amount: 100000,
          },
          output: {
            asset: wbtc,
            // TWAP 1 WBTC ~= 40,250 USDC
            expectedAmount: 2.485,
            buffer: 0.1,
          },
        })
      })

      context('assets without enough v3 pool history', () => {
        // These assets (SNX, YFI, 1INCH) did not have their history lengthened yet
        it('cannot query trades', async () => {
          // See https://github.com/Uniswap/uniswap-v3-core/blob/main/contracts/libraries/Oracle.sol#L226
          await expect(
            oracle.uniV3TwapAssetToAsset(snx.address, snx.toAmountD('1000'), weth.address, twapPeriod)
          ).to.be.revertedWith('OLD')
          await expect(
            oracle.uniV3TwapAssetToAsset(yfi.address, yfi.toAmountD('1000'), weth.address, twapPeriod)
          ).to.be.revertedWith('OLD')
          await expect(
            oracle.uniV3TwapAssetToAsset(oneinch.address, oneinch.toAmountD('1000'), weth.address, twapPeriod)
          ).to.be.revertedWith('OLD')
        })
      })
    })
  })

  context('uniV3SpotAssetToAsset', () => {
    function itQueriesTrade(name, { input, output }) {
      it(name, async () => {
        const { asset: assetIn, amount: amountIn } = input
        const { asset: assetOut, expectedAmount, buffer } = output

        const outD = await oracle.uniV3SpotAssetToAsset(assetIn.address, assetIn.toAmountD(amountIn), assetOut.address)
        const out = Number(assetOut.formatAmountD(outD))

        expect(out).to.be.closeTo(expectedAmount, buffer)
      })
    }

    itQueriesTrade('usdc -> eth', {
      input: {
        asset: usdc,
        amount: 10000,
      },
      output: {
        asset: weth,
        // 1 ETH ~= 2850 USDC
        expectedAmount: 3.51,
        buffer: 0.05,
      },
    })

    itQueriesTrade('eth -> usdc', {
      input: {
        asset: weth,
        amount: 10,
      },
      output: {
        asset: usdc,
        // 1 ETH ~= 2850 USDC
        expectedAmount: 28500,
        buffer: 100,
      },
    })

    itQueriesTrade('wbtc -> usdc (through eth)', {
      input: {
        asset: wbtc,
        amount: 10,
      },
      output: {
        asset: usdc,
        // 1 WBTC ~= 40,000 USDC
        expectedAmount: 400000,
        buffer: 1500,
      },
    })

    itQueriesTrade('usdc -> wbtc (through eth)', {
      input: {
        asset: usdc,
        amount: 100000,
      },
      output: {
        asset: wbtc,
        // 1 WBTC ~= 40,000 USDC
        expectedAmount: 2.5,
        buffer: 0.1,
      },
    })

    itQueriesTrade('snx -> wbtc (through eth)', {
      input: {
        asset: snx,
        amount: 5000,
      },
      output: {
        asset: wbtc,
        // 1 WBTC ~= 40,000 USDC
        // 1 SNX ~= 14.5 USDC
        expectedAmount: 1.8125,
        buffer: 0.15,
      },
    })

    itQueriesTrade('wbtc -> snx (through eth)', {
      input: {
        asset: wbtc,
        amount: 10,
      },
      output: {
        asset: snx,
        // 1 WBTC ~= 40,000 USDC
        // 1 SNX ~= 14.5 USDC
        expectedAmount: 27500,
        buffer: 200,
      },
    })
  })

  context('uniV2SpotAssetToAsset', () => {
    function itQueriesTrade(name, { factory, input, output }) {
      it(name, async () => {
        const { asset: assetIn, amount: amountIn } = input
        const { asset: assetOut, expectedAmount, buffer } = output

        const outD = await oracle.uniV2SpotAssetToAsset(
          factory,
          assetIn.address,
          assetIn.toAmountD(amountIn),
          assetOut.address
        )
        const out = Number(assetOut.formatAmountD(outD))

        expect(out).to.be.closeTo(expectedAmount, buffer)
      })
    }

    context('uniswapV2', () => {
      const factory = config.uniswapV2Factory

      itQueriesTrade('usdc -> eth', {
        factory,
        input: {
          asset: usdc,
          amount: 10000,
        },
        output: {
          asset: weth,
          // 1 ETH ~= 2850 USDC
          expectedAmount: 3.51,
          buffer: 0.05,
        },
      })

      itQueriesTrade('eth -> usdc', {
        factory,
        input: {
          asset: weth,
          amount: 10,
        },
        output: {
          asset: usdc,
          // 1 ETH ~= 2850 USDC
          expectedAmount: 28500,
          buffer: 100,
        },
      })

      itQueriesTrade('wbtc -> usdc (through eth)', {
        factory,
        input: {
          asset: wbtc,
          amount: 10,
        },
        output: {
          asset: usdc,
          // 1 WBTC ~= 40,000 USDC
          expectedAmount: 400000,
          buffer: 1000,
        },
      })

      itQueriesTrade('usdc -> wbtc (through eth)', {
        factory,
        input: {
          asset: usdc,
          amount: 100000,
        },
        output: {
          asset: wbtc,
          // 1 WBTC ~= 40,000 USDC
          expectedAmount: 2.5,
          buffer: 0.1,
        },
      })

      itQueriesTrade('snx -> wbtc (through eth)', {
        factory,
        input: {
          asset: snx,
          amount: 5000,
        },
        output: {
          asset: wbtc,
          // 1 WBTC ~= 40,000 USDC
          // 1 SNX ~= 14.5 USDC
          expectedAmount: 1.8125,
          buffer: 0.05,
        },
      })

      itQueriesTrade('wbtc -> snx (through eth)', {
        factory,
        input: {
          asset: wbtc,
          amount: 10,
        },
        output: {
          asset: snx,
          // 1 WBTC ~= 40,000 USDC
          // 1 SNX ~= 14.5 USDC
          expectedAmount: 27500,
          buffer: 100,
        },
      })
    })

    context('sushiswap', () => {
      const factory = config.sushiswapFactory

      itQueriesTrade('usdc -> eth', {
        factory,
        input: {
          asset: usdc,
          amount: 10000,
        },
        output: {
          asset: weth,
          // 1 ETH ~= 2850 USDC
          expectedAmount: 3.51,
          buffer: 0.05,
        },
      })

      itQueriesTrade('eth -> usdc', {
        factory,
        input: {
          asset: weth,
          amount: 10,
        },
        output: {
          asset: usdc,
          // 1 ETH ~= 2850 USDC
          expectedAmount: 28500,
          buffer: 100,
        },
      })

      itQueriesTrade('wbtc -> usdc (through eth)', {
        factory,
        input: {
          asset: wbtc,
          amount: 10,
        },
        output: {
          asset: usdc,
          // 1 WBTC ~= 40,000 USDC
          expectedAmount: 400000,
          buffer: 1000,
        },
      })

      itQueriesTrade('usdc -> wbtc (through eth)', {
        factory,
        input: {
          asset: usdc,
          amount: 100000,
        },
        output: {
          asset: wbtc,
          // 1 WBTC ~= 40,000 USDC
          expectedAmount: 2.5,
          buffer: 0.1,
        },
      })

      itQueriesTrade('snx -> wbtc (through eth)', {
        factory,
        input: {
          asset: snx,
          amount: 5000,
        },
        output: {
          asset: wbtc,
          // 1 WBTC ~= 40,000 USDC
          // 1 SNX ~= 14.5 USDC
          expectedAmount: 1.8125,
          buffer: 0.05,
        },
      })

      itQueriesTrade('wbtc -> snx (through eth)', {
        factory,
        input: {
          asset: wbtc,
          amount: 10,
        },
        output: {
          asset: snx,
          // 1 WBTC ~= 40,000 USDC
          // 1 SNX ~= 14.5 USDC
          expectedAmount: 27500,
          buffer: 100,
        },
      })
    })
  })
})
