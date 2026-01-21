import asyncio
from vnstock import Screener

async def test_screener():
    print("Testing Screener...")
    s = Screener()
    df = s.stock(params={"exchangeName": "HOSE,HNX,UPCOM"}, limit=10)
    print(df)

if __name__ == "__main__":
    asyncio.run(test_screener())
