const hre = require('hardhat')
const inquirer = require('inquirer')

const config = require('../config/mainnet')

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
    config.sushiswapFactory,
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
      config.sushiswapFactory,
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
