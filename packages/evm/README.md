# Multiprice Oracle (EVM)

> 🚨 Not intended to provide safe values for for on-chain queries!

## Deployments

- Mainnet: [`0x1f53a354b726Dcd1FC8053182a46dE6b9995740F`](https://etherscan.io/address/0x1f53a354b726dcd1fc8053182a46de6b9995740f#readContract)

## Usage

### `assetToAsset()`

Query one asset's price in terms of another asset.

On-chain price sources include:

- ChainLink
- UniswapV3 TWAP
- UniswapV3 spot
- UniswapV2 spot
- Sushiswap spot

**Parameters:**

- `tokenIn`: input token
- `amountIn`: amount of input token (in input token's decimals)
- `tokenOut`: output token
- `clPriceBuffer`: ChainLink price buffer (in bps, no decimals) to down-adjust ChainLink price
- `uniswapV3TwapPeriod`: TWAP period to use for UniswapV3 TWAP price
- `inclusionBitmap`: a bitmap configuring which price sources to consider in the final result (`value`)

`inclusionBitmap` maps the bits to sources like so, taking the minimum output amount amongst the selected sources:

```
x x x x x
| | | | |
| | | | --- chainlink price (after buffer)
| | | ----- uniswap v3 twap
| | ------- uniswap v3 spot
| --------- uniswap v2 spot
----------- sushi spot
```

**Outputs:**

- `value`: final output amount, based on `inclusionBitmap`
- `cl`: output amount based on current ChainLink price
- `clBuf`: output amount based on current ChainLink price after applying price buffer
- `uniV3Twap`: output amount based on current Uniswap v3 TWAP period
- `uniV3Spot`: output amount based on current Uniswap v3 spot
- `uniV2Spot`: output amount based on current Uniswap v2 spot
- `sushiSpot`: output amount based on current Sushiwap spot
