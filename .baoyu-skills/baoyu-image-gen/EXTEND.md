---
version: 1
default_provider: openai
# api.codexzh.com 网关对 gpt-image-2 的 2k(quality=high)生成会稳定超时，默认用 normal；
# 单次确需高清可加 --quality 2k 或改用其它 provider。
default_quality: normal
default_aspect_ratio: "16:9"
default_image_api_dialect: openai-native
default_model:
  openai: "gpt-image-2"
batch:
  max_workers: 10
---
