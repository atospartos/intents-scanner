import { nearIntentsClient } from './clients/nearIntentsClient';


async function main() {

    const tokens = await nearIntentsClient.getTokens();
    console.log(tokens)
}

main().catch(console.error);