import React, { useEffect, useState } from "react";
import { defaultChatGreeting, type ChatGreetingSettings } from "@shared/chatGreeting";
import { WidgetApiClient } from "@/widget/api";

export function ChatGreetingContent({settings}:{settings:ChatGreetingSettings}) {
  return <div className="space-y-3"><p className="text-sm whitespace-pre-wrap break-words">{settings.description}</p>{settings.questionHelp&&<p className="text-sm text-muted-foreground whitespace-pre-wrap break-words">{settings.questionHelp}</p>}</div>;
}
/** Both widget and test panel read the public configuration through this component. */
export function ChatGreeting({apiBaseUrl=""}:{apiBaseUrl?:string}) {
  const [settings,setSettings]=useState(defaultChatGreeting);
  useEffect(()=>{
    const api=new WidgetApiClient(apiBaseUrl);
    let controller:AbortController|undefined;
    let disposed=false;
    const refresh=()=>{
      controller?.abort();controller=new AbortController();
      void api.getGreeting(controller.signal).then(value=>{if(!disposed)setSettings(value);}).catch(error=>{
        if(!disposed && error?.name!=="AbortError")console.warn("[Chat] Using default greeting:",error);
      });
    };
    refresh();window.addEventListener("focus",refresh);
    return ()=>{disposed=true;controller?.abort();window.removeEventListener("focus",refresh);};
  },[apiBaseUrl]);
  return <ChatGreetingContent settings={settings}/>;
}
