import { Orderbook } from '@0x/orderbook';
import { Order } from '@0x/types';
import { BigNumber } from 'bignumber.js';
import axios from 'axios';
import * as ethers from 'ethers';
import * as ethjs from 'ethereumjs-util';
import * as fs from 'fs';
import * as _ from 'lodash';
import * as process from 'process';
import * as yargs from 'yargs';

import * as TOKENS from '../tokens.json';

interface ExternalQuotes {
    '1inch': BigNumber;
}

const PAIRS = [
    { pair: 'ETH/DAI', sellAmounts: [0.1, 1, 10, 100] },
    { pair: 'DAI/ETH', sellAmounts: [50, 100, 1e3, 10e3] },
    { pair: 'ETH/USDC', sellAmounts: [0.1, 10, 100, 1e3] },
    { pair: 'USDC/ETH', sellAmounts: [50, 100, 1e3, 10e3] },
    { pair: 'ETH/ZRX', sellAmounts: [0.1, 1, 10, 100] },
    { pair: 'ZRX/ETH', sellAmounts: [50, 100, 1e3, 10e3] },
    { pair: 'ETH/BAT', sellAmounts: [0.1, 1, 10, 100] },
    { pair: 'BAT/ETH', sellAmounts: [50, 100, 1e3, 10e3] },
    { pair: 'DAI/ZRX', sellAmounts: [50, 100, 1e3, 10e3] },
    { pair: 'ZRX/DAI', sellAmounts: [50, 100, 1e3, 10e3] },
];

(async () => {
    const outputFile = yargs.argv._[0] || './output';
    const samples = await fetchSamplesAsync();
    await fs.promises.writeFile(
        outputFile,
        JSON.stringify(stringifyBigNumbers(samples)) + '\n',
        { flag: 'a' },
    );
    process.exit();
})();

async function fetchSamplesAsync(): Promise<any> {
    const samples = [];
    for (const pair of PAIRS) {
        const [takerToken, makerToken] = pair.pair.split('/');
        const [blockNumber, orders, sellQuotes] = await Promise.all([
            fetchCurrentBlockNumber(),
            fetchNativeOrdersAsync(makerToken, takerToken),
            Promise.all(
                pair.sellAmounts
                    .map(a => toBaseUnits(a, makerToken))
                    .map(async amount => ({
                        amount,
                        sources: await fetchSellQuotesAsync(
                            makerToken,
                            takerToken,
                            amount,
                        ),
                    })),
            ),
        ]);
        samples.push({
            blockNumber,
            makerToken,
            takerToken,
            orders,
            sellQuotes,
            makerTokenAddress: TOKENS[makerToken].address,
            takerTokenAddress: TOKENS[takerToken].address,
        });
    }
    return samples;
}

function createERC20AssetData(tokenAddress: string): string {
    const buf = Buffer.concat([
        ethjs.keccak256('ERC20Token(address)').slice(0, 4),
        ethjs.setLengthLeft(tokenAddress, 32),
    ]);
    return ethjs.bufferToHex(buf);
}

function stringifyBigNumbers(x: any): any {
    if (BigNumber.isBigNumber(x)) {
        return (x as BigNumber).toString(10);
    }
    if (_.isArray(x)) {
        return x.map(v => stringifyBigNumbers(v));
    }
    if (_.isPlainObject(x)) {
        return _.mapValues(x, v => stringifyBigNumbers(v));
    }
    return x;
}

function toBaseUnits(amount: number | BigNumber, token?: string): BigNumber {
    const decimals = token ? TOKENS[token].decimals : 18;
    return new BigNumber(10).pow(decimals).times(amount);
}

async function fetchCurrentBlockNumber(): Promise<number> {
    return ethers.getDefaultProvider().getBlockNumber();
}

async function fetchNativeOrdersAsync(
    makerToken: string,
    takerToken: string,
): Promise<Order[]> {
    const sra = Orderbook.getOrderbookForPollingProvider({
        httpEndpoint: 'https://api.0x.org/sra',
        pollingIntervalMs: 5000,
        perPage: 100,
    });
    const [makerTokenAddress, takerTokenAddress] =
        [makerToken, takerToken].map(s => TOKENS[s].address);
    const page = await sra.getOrdersAsync(
        createERC20AssetData(makerTokenAddress),
        createERC20AssetData(takerTokenAddress),
    );
    return page.map(p => p.order);
}

async function fetchSellQuotesAsync(
    makerToken: string,
    takerToken: string,
    sellAmount: BigNumber,
): Promise<ExternalQuotes> {
    return {
        '1inch': await fetch1inchQuoteAsync(makerToken, takerToken, sellAmount),
    };
}

async function fetch1inchQuoteAsync(
    makerToken: string,
    takerToken: string,
    sellAmount: BigNumber,
): Promise<BigNumber> {
    const params = {
        'fromTokenSymbol': takerToken,
        'toTokenSymbol': makerToken,
        'amount': sellAmount.toString(10),
        'disabledExchangesList': 'Bancor,AirSwap,PMM',
    };
    const r = await axios('https://api.1inch.exchange/v1.1/quote', { params });
    return new BigNumber(r.data.toTokenAmount);
}
