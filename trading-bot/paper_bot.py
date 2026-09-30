import json, math
from pathlib import Path
from datetime import datetime, timezone

DATA = Path("trading-bot/data/btcphp-4h.json")
STATE = Path("trading-bot/data/paper-state.json")

FEE = 0.001
SLIPPAGE = 0.0005
RISK_PCT = 0.01
LOOKBACK = 30
ADX_MIN = 20
INIT_ATR = 2.0
TRAIL_ATR = 3.0

def ema(vals, p):
    out=[None]*len(vals)
    if len(vals)<p: return out
    s=sum(vals[:p]); out[p-1]=s/p
    k=2/(p+1)
    for i in range(p,len(vals)):
        out[i]=vals[i]*k+out[i-1]*(1-k)
    return out

def atr(rows,p=14):
    tr=[0.0]*len(rows); out=[None]*len(rows)
    for i in range(1,len(rows)):
        h,l,pc=rows[i]["high"],rows[i]["low"],rows[i-1]["close"]
        tr[i]=max(h-l,abs(h-pc),abs(l-pc))
    if len(rows)<=p:return out
    s=sum(tr[1:p+1]); out[p]=s/p
    for i in range(p+1,len(rows)):
        out[i]=(out[i-1]*(p-1)+tr[i])/p
    return out

def adx(rows,p=14):
    n=len(rows); plus=[0.0]*n; minus=[0.0]*n; tr=[0.0]*n; dx=[None]*n; out=[None]*n
    for i in range(1,n):
        up=rows[i]["high"]-rows[i-1]["high"]
        dn=rows[i-1]["low"]-rows[i]["low"]
        plus[i]=up if up>dn and up>0 else 0
        minus[i]=dn if dn>up and dn>0 else 0
        tr[i]=max(rows[i]["high"]-rows[i]["low"],abs(rows[i]["high"]-rows[i-1]["close"]),abs(rows[i]["low"]-rows[i-1]["close"]))
    if n<=p*2:return out
    trs=sum(tr[1:p+1]); ps=sum(plus[1:p+1]); ms=sum(minus[1:p+1])
    for i in range(p,n):
        if i>p:
            trs=trs-trs/p+tr[i]; ps=ps-ps/p+plus[i]; ms=ms-ms/p+minus[i]
        pdi=100*ps/trs if trs else 0; mdi=100*ms/trs if trs else 0
        dx[i]=100*abs(pdi-mdi)/(pdi+mdi) if pdi+mdi else 0
    seed=[x for x in dx[p:p*2] if x is not None]
    out[p*2-1]=sum(seed)/len(seed)
    for i in range(p*2,n):
        out[i]=(out[i-1]*(p-1)+dx[i])/p
    return out

def load_rows():
    raw=json.loads(DATA.read_text())
    return [{"time":int(k[0]),"open":float(k[1]),"high":float(k[2]),"low":float(k[3]),"close":float(k[4]),"volume":float(k[5])} for k in raw]

def main():
    rows=load_rows()
    st=json.loads(STATE.read_text())
    close=[r["close"] for r in rows]
    e50,e200=ema(close,50),ema(close,200)
    a=atr(rows,14); ax=adx(rows,14)

    start_idx=220
    if st.get("last_processed"):
        newer=[i for i,r in enumerate(rows) if r["time"]>st["last_processed"]]
        if not newer:
            st["last_price"]=rows[-1]["close"]
            st["updated_at"]=datetime.now(timezone.utc).isoformat()
            STATE.write_text(json.dumps(st,indent=2))
            return
        start_idx=max(start_idx,newer[0])

    for i in range(start_idx,len(rows)):
        r=rows[i]
        if any(x is None for x in (e50[i],e200[i],a[i],ax[i])): continue
        slope=(e200[i]-e200[i-20])/e200[i]
        bull=r["close"]>e200[i] and e50[i]>e200[i] and slope>0 and ax[i]>=ADX_MIN
        pos=st.get("position")

        if pos:
            pos["highest"]=max(pos["highest"],r["high"])
            trail=pos["highest"]-TRAIL_ATR*a[i]
            pos["stop"]=max(pos["stop"],trail)
            exit_price=None; reason=None
            if r["low"]<=pos["stop"]:
                exit_price=pos["stop"]*(1-SLIPPAGE); reason="ATR stop/trail"
            elif not bull:
                exit_price=r["close"]*(1-SLIPPAGE); reason="Bull regime ended"
            if exit_price is not None:
                gross=st["btc"]*exit_price
                fee=gross*FEE
                proceeds=gross-fee
                pnl=proceeds-pos["cost"]
                st["cash"]+=proceeds
                st["realized_pnl"]+=pnl
                st["fees_paid"]+=fee
                st["trades"].append({
                    "entry_time":pos["entry_time"],"exit_time":r["time"],
                    "entry_price":pos["entry_price"],"exit_price":exit_price,
                    "qty":st["btc"],"pnl":pnl,"reason":reason
                })
                st["btc"]=0
                st["position"]=None
                st["last_signal"]="EXIT"
                pos=None

        if st.get("position") is None and bull:
            prev_high=max(close[max(0,i-LOOKBACK):i]) if i>0 else r["close"]
            breakout=r["close"]>prev_high
            if breakout and a[i]>0:
                entry=r["close"]*(1+SLIPPAGE)
                equity=st["cash"]
                risk_cash=equity*RISK_PCT
                risk_per_btc=INIT_ATR*a[i]
                qty=min(risk_cash/risk_per_btc, st["cash"]/(entry*(1+FEE)))
                if qty>0:
                    cost=qty*entry
                    fee=cost*FEE
                    total=cost+fee
                    st["cash"]-=total
                    st["btc"]=qty
                    st["fees_paid"]+=fee
                    st["position"]={
                        "entry_time":r["time"],"entry_price":entry,"qty":qty,
                        "cost":total,"highest":r["high"],"stop":entry-INIT_ATR*a[i]
                    }
                    st["last_signal"]="BUY"
            else:
                st["last_signal"]="WATCH"
        elif st.get("position") is None:
            st["last_signal"]="WAIT"

        st["last_processed"]=r["time"]
        st["last_price"]=r["close"]

    if len(st["trades"])>100:
        st["trades"]=st["trades"][-100:]
    st["updated_at"]=datetime.now(timezone.utc).isoformat()
    STATE.write_text(json.dumps(st,indent=2))

if __name__=="__main__":
    main()
