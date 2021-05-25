const hre = require('hardhat')
const inquirer = require('inquirer')

const config = {
  chainLinkRegistry: '0x271bf4568fb737cc2e6277e9B1EE0034098cDA2a',
  uniswapV3Factory: '0x1F98431c8aD98523631AE4a59f267346ea31F984',
  uniswapV3PoolFee: '3000',
  uniswapV3Oracle: '0x0F1f5A87f99f0918e6C81F16E59F3518698221Ff',
  uniswapV2Factory: '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f',
  sushiswapV2Factory: '0xC0AEe478e3658e2610c5F7A4A2E1777cE9e4f2Ac',
  weth: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
  usdEquivalents: ['0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', '0xdAC17F958D2ee523a2206206994597C13D831ec7'],
}

async function sanity() {
  if (!hre.config.etherscan.apiKey) {
    console.log('Missing Etherscan API key!')
    throw new Error('Missing Etherscan API key')
  }
}

async function confirm() {
  console.log(`Will deploy MultipriceOracle, binded to:`)
  Object.entries(config).forEach(([k, v]) => {
    console.log(`  - ${k}: ${v}`)
  })
  console.log()

  const { confirmed } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'confirmed',
      message: 'Proceed?',
      default: false,
    },
  ])
  console.log()
  return confirmed
}

async function deploy() {
  console.log('Deploying...')
  const MultipriceOracle = await hre.ethers.getContractFactory('MultipriceOracle')
  const multipriceOracle = await MultipriceOracle.deploy(
    config.chainLinkRegistry,
    config.uniswapV3Factory,
    config.uniswapV3PoolFee,
    config.uniswapV3Oracle,
    config.uniswapV2Factory,
    config.sushiswapV2Factory,
    config.weth,
    config.usdEquivalents
  )

  await multipriceOracle.deployed()
  console.log(`Deployed to address: ${multipriceOracle.address}`)

  return multipriceOracle
}

async function verify(multipriceOracle) {
  console.log()
  console.log('Verifying on Etherscan...')
  await hre.run('verify:verify', {
    address: multipriceOracle.address,
    constructorArguments: [
      config.chainLinkRegistry,
      config.uniswapV3Factory,
      config.uniswapV3PoolFee,
      config.uniswapV3Oracle,
      config.uniswapV2Factory,
      config.sushiswapV2Factory,
      config.weth,
      config.usdEquivalents,
    ],
  })
}

async function main() {
  console.log(`Connecting to ${hre.network.name}...`)
  await sanity()
  if (!(await confirm())) {
    console.log('Aborting...')
    return
  }

  // Ok, go ahead and deploy
  const multipriceOracle = await deploy()
  await verify(multipriceOracle)

  console.log()
  console.log('All done :)')
}

// Recommended pattern
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
