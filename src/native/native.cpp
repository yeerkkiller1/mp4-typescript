#include <nan.h>

// https://community.risingstack.com/using-buffers-node-js-c-plus-plus/

void Method(const Nan::FunctionCallbackInfo<v8::Value>& info) {
  if (info.Length() < 1) {
    Nan::ThrowTypeError("Wrong number of arguments");
    return;
  }

  /*
  if (!info[0]->IsString()) {
    Nan::ThrowTypeError("Wrong arguments");
    return;
  }
  */

  char* buffer = (char*) node::Buffer::Data(info[0]->ToObject());

  buffer[0] = 70;
  buffer[1] = 70;

  int size = 5;
  char * retval = new char[size];
  for(unsigned int i = 0; i < size; i++ ) {
      retval[i] = 75;
  }   
  
  info.GetReturnValue().Set(Nan::NewBuffer(retval, size).ToLocalChecked());
  

  //auto test = info[0].As<v8::String>();
  //int k = test;

  //auto test = v8::String::NewFromUtf8(v8::Isolate::GetCurrent(), buffer, v8::NewStringType::kNormal, 2);

  //info.GetReturnValue().Set(test.ToLocalChecked());
}

void Init(v8::Local<v8::Object> exports) {
  exports->Set(Nan::New("hello").ToLocalChecked(),
               Nan::New<v8::FunctionTemplate>(Method)->GetFunction());
}

NODE_MODULE(hello, Init)