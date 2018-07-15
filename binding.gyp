{
  "targets": [
    {
      "target_name": "native",
      "sources": [
        "./src/native/native.cpp"
      ],
      "include_dirs": [
        "<!(node -e \"require('nan')\")"
      ]
    }
  ]
}