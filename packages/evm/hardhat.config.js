require('@nomiclabs/hardhat-waffle')
require('@nomiclabs/hardhat-etherscan')
require('hardhat-local-networks-config-plugin')

const hardhat = {}
const forkingEnabled = !!process.env.FORK_NODE
if (forkingEnabled) {
  hardhat.forking = {
    url: process.env.FORK_NODE,
    // Ensures test reliability for price queries (05-26-2021)
    blockNumber: 12510000,
  }
}

module.exports = {
  solidity: {
    version: '0.7.6',
    settings: {
      optimizer: {
        enabled: true,
        runs: 1000,
      },
    },
  },
  networks: {
    hardhat,
    mainnet: {
      url: `https://mainnet.infura.io/v3/${process.env.INFURA_API_KEY}`,
    },
  },
  etherscan: {
    apiKey: process.env.ETHERSCAN_API_KEY,
  },
}
